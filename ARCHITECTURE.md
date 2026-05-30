# Ferrobox Implementation on f01.7c7.icu

## 服务架构
### 文件存储
Meta、Data均存储在『公共读，但不公共写』的Aliyun OSS上。
OSS暂定部署在中国内地（不排除将来改在中国香港）。
目前暂未确定Meta和Data是否存储在同一个Bucket中。

由于中间服务器不知道文件的任何信息（包括加密前、加密后的文件大小、校验码等），
Meta、Data的存储路径均为完全随机的NanoID（可能在中间插入`/`）。

### 中间服务器
用于上传、删除文件时的鉴权，其并不参与文件内容的转发。

暂定使用Netlify Functions。

### 客户端
`ferrobox-core`的调用方，可以在浏览器、Node.js等多个平台实现。
至少拥有上传、下载两大功能之一。

## 权限架构
- 下载：无需鉴权，人人都可以下载；任何知道密钥（key）的人都可以解密。
- 上传：通过中间服务器鉴权。该权限体系是基于非对称加密/证书的。不记录上传者身份。
- 删除：通过中间服务器鉴权，鉴权步骤与上传时相同。删除某一文件的用户不必是上传它的用户。

> 以下内容待定
### 根密钥对、根证书
根密钥对由服务所有者生成，private key不上云，仅用于以下两种用途：
1. 签发refresh token，有效期7天（30天？）；
2. 签发中间公钥的证书。

public key和中间密钥的证书在服务器的环境变量中保存，
用于验证refresh token和中间公钥的合法性。

### 中间密钥对
用于签发及验证access token，有效期15分钟（30分钟？5分钟？）。

签发access token所需凭据为refresh token。服务端会验证以下三项内容：
- refresh token是否过期
- refresh token的签名是否合法（via Root public key）
- refresh token是否在黑名单中

执行上传、删除操作时会验证access token的有效性（via Intermediate public key）。
中间服务器还应自检Intermediate public key的合法性（via Root public key）。
鉴权通过后，下发操作Aliyun OSS所需的Signatured URL及其他凭据。