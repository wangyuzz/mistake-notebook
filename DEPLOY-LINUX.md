# Linux 部署：Docker Compose + PostgreSQL

首次部署从空白数据库启动；已有部署可以按第 4 节更新并保留原数据。发布包不包含真实账号、用户错题、AI 密钥或 `.env`。建议服务器至少 2 核、2GB 内存，安装 Docker Engine 和 Docker Compose v2。Docker 会构建前端，无需在服务器上另装 Node.js。

从 [GitHub Releases](https://github.com/wangyuzz/mistake-notebook/releases) 下载 `mistake-notebook-linux-v1.0.0.tar.gz` 和 `SHA256SUMS.txt`，将两者放在同一目录后执行 `sha256sum -c SHA256SUMS.txt` 校验文件。后续版本请替换文件名中的版本号。

## 1. 上传与启动

将 `mistake-notebook-linux-v1.0.0.tar.gz` 上传到服务器，例如 `/opt/shiti/`，然后执行：

```sh
mkdir -p /opt/shiti
cd /opt/shiti
tar -xzf mistake-notebook-linux-v1.0.0.tar.gz
docker --version
docker compose version
sh deploy/init.sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app
```

首次构建需要从 Docker Hub 下载 Node.js / PostgreSQL 镜像，并从 npm 下载依赖。日志显示 `拾题 API` 后，等待 `app` 与 `db` 显示 healthy。若服务器端口 3001 被占用，在 `.env` 修改 `APP_PORT` 后重新启动。

`deploy/init.sh` 自动生成随机数据库密码、首位管理员初始化口令和配置加密密钥，写入权限为 600 的 `.env`。已有 `.env` 时脚本拒绝覆盖；更新版本也不需要重跑此脚本。

## 2. 首次访问

服务器安全组 / 防火墙放行 TCP 3001，浏览器打开 `http://服务器IP:3001`。先在服务器本地查看初始化口令：

```sh
sed -n 's/^SETUP_TOKEN=//p' .env
```

在初始化页面输入口令，创建你自己的管理员账号。管理员创建后，新用户可以直接注册普通账号；管理员在“管理控制台 → AI 与识别配置”填写 API 地址、密钥、模型和思考等级。

数据库服务仅供 Compose 内部访问，不向宿主机或公网开放 5432。`/api/health` 只返回健康状态，用于容器检查数据库可用性，不返回账号或配置。AI 调用由服务器发出，服务器需能访问所填 API 地址。

iPhone 可在 Safari 的分享菜单选择“添加到主屏幕”，使用浅绿底的书本图标。更新图标后，移除旧主屏幕图标，在 Safari 刷新网站并重新添加；系统通常会缓存已经安装的图标。

## 3. 域名与 HTTPS

通过服务器上的 Nginx 或宝塔反向代理到 `http://127.0.0.1:3001`。参考 `deploy/nginx.conf.example`：请求体上限至少 64MB，关闭代理缓冲并将读取超时设为 240 秒，保证图片导入和 AI 流式输出正常。

HTTPS 可用后，在 `.env` 修改：

```dotenv
APP_BIND_IP=127.0.0.1
COOKIE_SECURE=true
```

随后执行 `docker compose up -d`，只对外开放网站的 80 / 443 端口。此后使用 HTTPS 域名登录，HTTP IP 地址不再作为登录入口。若 Nginx 也在容器中，需另行将它接入本项目的 Docker 网络，使用 `app:3001` 作为上游。

## 4. 更新版本

将新版本部署包上传到原安装目录，保留原 `.env`，然后运行（按实际版本替换文件名）：

```sh
cd /opt/shiti
tar -xzf mistake-notebook-linux-v1.0.0.tar.gz
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app
```

账号和题目保存在 PostgreSQL 卷，辅助文件保存在 app_data 卷。不要执行 `docker compose down -v`，该命令会删除数据卷。不要改变项目目录名 / Compose 项目名称，否则 Compose 可能使用新的空卷。日常停止用 `docker compose stop`，启动用 `docker compose up -d`。

## 5. 备份

数据库、`.env` 和 app_data 应一起备份。`.env` 中的加密密钥用于解密数据库里的 AI 密钥，不能重新生成替代。

```sh
cd /opt/shiti
umask 077
backup_stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/$backup_stamp"
docker compose exec -T db pg_dump -U shiti -d shiti > "backups/$backup_stamp/database.sql"
cp .env "backups/$backup_stamp/deployment.env"
docker compose run --rm --no-deps -T --entrypoint tar app -czf - -C /app/data . > "backups/$backup_stamp/app-data.tar.gz"
```

将备份目录复制到其他磁盘或备份服务器。个人导出只包含当前用户学习资料，不能替代整站数据库备份。

## 故障定位

```sh
docker compose ps
docker compose logs --tail=100 db
docker compose logs --tail=100 app
```

- 无法打开：核对服务状态、`APP_PORT`、安全组和防火墙。
- HTTP 登录后一直返回登录页：检查是否提前将 `COOKIE_SECURE` 设成了 true。
- 图片导入出现 413：提高 Nginx / 面板的请求体上限。
- AI 回答等到最后才显示：关闭 Nginx / CDN 的响应缓冲；代理读取超时至少 240 秒。
- 修改数据库密码后无法启动：PostgreSQL 初始化变量只在空卷首次创建时生效，已有数据库不能仅靠修改 `.env` 改密码。

本部署包尚未在你的 Linux 服务器实际构建或运行。源码构建及 Compose 配置检查情况以交付说明为准。
