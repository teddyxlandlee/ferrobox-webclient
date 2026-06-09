import * as WebCryptoAuth from './auth-webcrypto.js';
import * as WebAuthnAuth from './auth-webauthn.js';
import * as AuthUtil from './authutil.js';
import { Buffer } from 'buffer';

// ─── Styles ────────────────────────────────────────────────────────────────

import './credentials.css';

// ─── Toast ─────────────────────────────────────────────────────────────────

const toastContainer = document.createElement('div');
toastContainer.className = 'toast-container';
document.body.appendChild(toastContainer);

function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function base64FromBuffer(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString('base64');
}

function downloadFile(content: ArrayBuffer | Uint8Array<ArrayBuffer>, filename: string, mime = 'application/octet-stream') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatId(id: string): string {
  if (id.length <= 40) return id;
  return id.slice(0, 18) + '…' + id.slice(-18);
}

// ─── App State ─────────────────────────────────────────────────────────────

type CreateKeyType = 'webcrypto' | 'webauthn';
let currentCreateType: CreateKeyType = 'webcrypto';

interface CredentialEntry {
  keyHandle: AuthUtil.KeyHandle;
  hasCerts: boolean;
}

let credentialList: CredentialEntry[] = [];

// ─── DOM is already in credentials.html ────────────────────────────────────

const createCard = document.querySelector('.card:nth-child(2)') as HTMLElement;

// ─── Event Bindings ────────────────────────────────────────────────────────

// Key type tabs
const tabs = createCard.querySelectorAll('.key-type-tab');
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentCreateType = (tab.getAttribute('data-type') as CreateKeyType);
  });
});
(tabs[0] as HTMLElement).classList.add('active');

// Generate key
const btnGenerate = document.getElementById('btn-generate') as HTMLButtonElement;
const keyIdInput = document.getElementById('key-id') as HTMLInputElement;
const pubKeyOutput = document.getElementById('public-key-output') as HTMLDivElement;
const pubKeyText = document.getElementById('public-key-text') as HTMLTextAreaElement;
const btnDownloadPub = document.getElementById('btn-download-pubkey') as HTMLButtonElement;
const btnCopyPub = document.getElementById('btn-copy-pubkey') as HTMLButtonElement;

async function handleGenerate() {
  const id = keyIdInput.value.trim();
  if (!id) { showToast('Please enter a Key ID', 'error'); return; }

  btnGenerate.disabled = true;
  btnGenerate.textContent = 'Generating…';
  pubKeyOutput.style.display = 'none';

  try {
    let publicKey: ArrayBuffer;
    if (currentCreateType === 'webcrypto') {
      publicKey = await WebCryptoAuth.generateKeyPair(id);
    } else {
      publicKey = await WebAuthnAuth.generateKeyPair(id);
      // Store a certs marker so the credential appears in listings
      const handle: AuthUtil.KeyHandle = { type: 'webauthn', id };
      try {
        await AuthUtil.storeCerts(handle, []);
      } catch (err) {
        // non-fatal
        console.warn('Failed to store certs marker for WebAuthn key:', err);
      }
    }

    const b64 = base64FromBuffer(publicKey);
    pubKeyText.value = b64;
    pubKeyOutput.style.display = 'block';
    showToast(`Key pair "${id}" generated successfully`, 'success');
    refreshList();
  } catch (err: any) {
    showToast(`Generation failed: ${err.message || err}`, 'error');
    console.error('Generation error:', err);
  } finally {
    btnGenerate.disabled = false;
    btnGenerate.textContent = 'Generate & Export Public Key';
  }
}
btnGenerate.addEventListener('click', handleGenerate);

btnDownloadPub.addEventListener('click', () => {
  downloadFile(Buffer.from(pubKeyText.value), `public-key-${keyIdInput.value.trim()}.der`);
  showToast('Public key downloaded', 'success');
});

btnCopyPub.addEventListener('click', () => {
  navigator.clipboard.writeText(pubKeyText.value).then(() => {
    showToast('Public key copied to clipboard', 'success');
  }).catch(() => {
    showToast('Failed to copy', 'error');
  });
});

// Certificate chain management
const certKeyType = document.getElementById('cert-key-type') as HTMLSelectElement;
const certKeyId = document.getElementById('cert-key-id') as HTMLInputElement;
const certEntries = document.getElementById('cert-entries')!;
const btnAddCert = document.getElementById('btn-add-cert')!;
const btnSaveCerts = document.getElementById('btn-save-certs')!;

btnAddCert.addEventListener('click', () => {
  const index = certEntries.children.length;
  const div = document.createElement('div');
  div.className = 'field cert-entry';
  div.innerHTML = `
    <label>Certificate #${index + 1} (PEM)</label>
    <textarea placeholder="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"></textarea>
  `;
  certEntries.appendChild(div);
});

btnSaveCerts.addEventListener('click', async () => {
  const type = certKeyType.value as 'webcrypto' | 'webauthn';
  const id = certKeyId.value.trim();
  if (!id) { showToast('Please enter a Key ID', 'error'); return; }

  const textareas = certEntries.querySelectorAll('textarea');
  const certs: string[] = [];
  for (const ta of textareas) {
    const val = (ta as HTMLTextAreaElement).value.trim();
    if (val) certs.push(val);
  }
  if (certs.length === 0) { showToast('Please enter at least one certificate', 'error'); return; }

  const handle: AuthUtil.KeyHandle = { type, id };
  try {
    await AuthUtil.storeCerts(handle, certs);
    showToast(`Certificate chain saved for "${type}:${id}"`, 'success');
    refreshList();
  } catch (err: any) {
    showToast(`Failed to save certificates: ${err.message || err}`, 'error');
    console.error('Save certs error:', err);
  }
});

// Credential list
const credentialListEl = document.getElementById('credential-list')!;
const btnRefresh = document.getElementById('btn-refresh')!;

async function refreshList() {
  credentialListEl.innerHTML = '<p style="text-align:center;color:#999;">Loading…</p>';

  try {
    // Gather WebCrypto keys
    const webCryptoIds = await WebCryptoAuth.listKeys();
    // Gather handles from certs store
    const handles = await AuthUtil.listAllHandles();

    // Merge: for each handle, check if certs exist
    const uniqueMap = new Map<string, CredentialEntry>();

    for (const h of handles) {
      const key = h.type + ':' + h.id;
      // Use a private method to read certs status
      const certs = await AuthUtil.readCerts(h);
      uniqueMap.set(key, {
        keyHandle: h,
        hasCerts: certs !== null && certs.length > 0,
      });
    }

    // Add WebCrypto keys that may not have a cert entry yet
    for (const id of webCryptoIds) {
      const key = 'webcrypto:' + id;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, {
          keyHandle: { type: 'webcrypto', id },
          hasCerts: false,
        });
      }
    }

    credentialList = Array.from(uniqueMap.values());
    renderList();
  } catch (err: any) {
    credentialListEl.innerHTML = `<p style="color:#e74c3c;text-align:center;">Failed to load: ${err.message || err}</p>`;
    console.error('Load credentials error:', err);
  }
}

function renderList() {
  if (credentialList.length === 0) {
    credentialListEl.innerHTML = '<div class="empty-state">No credentials found. Generate one above!</div>';
    return;
  }

  credentialListEl.innerHTML = '';
  for (const entry of credentialList) {
    const { keyHandle, hasCerts } = entry;
    const item = document.createElement('div');
    item.className = 'credential-item';

    const typeLabel = keyHandle.type === 'webauthn' ? 'WebAuthn' : 'WebCrypto';
    const typeClass = keyHandle.type === 'webauthn' ? 'type-webauthn' : 'type-webcrypto';

    item.innerHTML = `
      <div class="credential-info">
        <div>
          <span class="credential-type ${typeClass}">${typeLabel}</span>
          <span class="credential-id">${formatId(keyHandle.id)}</span>
        </div>
        <div style="margin-top:4px;">
          <span class="badge-certs">${hasCerts ? '✓ Certificate chain attached' : 'No certificate chain'}</span>
        </div>
      </div>
      <div class="flex gap-sm">
        <button class="btn btn-outline btn-export-pub" style="font-size:0.75rem;padding:4px 10px;">Export PubKey</button>
        <button class="btn btn-outline btn-delete-cred" style="font-size:0.75rem;padding:4px 10px;color:#e74c3c;border-color:#e74c3c;">Delete</button>
      </div>
    `;

    const exportBtn = item.querySelector('.btn-export-pub')!;
    exportBtn.addEventListener('click', () => exportPublicKey(keyHandle));

    const deleteBtn = item.querySelector('.btn-delete-cred')!;
    deleteBtn.addEventListener('click', () => confirmDelete(keyHandle));

    credentialListEl.appendChild(item);
  }
}

async function exportPublicKey(handle: AuthUtil.KeyHandle) {
  try {
    let publicKey: ArrayBuffer;
    if (handle.type === 'webcrypto') {
      const key = await WebCryptoAuth.getKey(handle.id);
      publicKey = await crypto.subtle.exportKey('spki', key.publicKey);
    } else {
      showToast('WebAuthn public key was not stored. Re-generate the key to export it.', 'info');
      return;
    }
    // const b64 = base64FromBuffer(publicKey);
    downloadFile(publicKey, `public-key-${handle.id}.der`);
    showToast('Public key exported', 'success');
  } catch (err: any) {
    showToast(`Export failed: ${err.message || err}`, 'error');
    console.error('Export error:', err);
  }
}

function confirmDelete(handle: AuthUtil.KeyHandle) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>Delete Credential</h2>
      <p>Are you sure you want to delete the <strong>${handle.type}</strong> key "<strong>${handle.id}</strong>"?</p>
      <p style="font-size:0.85rem;color:#e74c3c;">This will remove the private key and associated certificate chain. This action cannot be undone.</p>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
        <button class="btn btn-danger" id="modal-confirm">Delete</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#modal-cancel')!.addEventListener('click', () => overlay.remove());
  overlay.querySelector('#modal-confirm')!.addEventListener('click', async () => {
    try {
      if (handle.type === 'webcrypto') {
        await WebCryptoAuth.deleteKey(handle.id);
      }
      await AuthUtil.deleteCerts(handle);
      showToast(`Credential "${handle.id}" deleted`, 'success');
      overlay.remove();
      refreshList();
    } catch (err: any) {
      showToast(`Deletion failed: ${err.message || err}`, 'error');
      overlay.remove();
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

btnRefresh.addEventListener('click', refreshList);

// ─── Initial Load ──────────────────────────────────────────────────────────

refreshList();