# 部署到 opth.ducheng-industrial.com

目标：新系统替换现有 opth 内容，域名沿用。

## 一台主机即可（Ubuntu 22.04+，2 vCPU / 4 GB 起）

```bash
# 1. Docker
curl -fsSL https://get.docker.com | sh

# 2. 代码
git clone https://github.com/james007zhu-tech/iMROT.git /opt/dcit-os && cd /opt/dcit-os
cp .env.example .env
# 编辑 .env：SESSION_SECRET 换成长随机串；ANTHROPIC_API_KEY；SEED_ADMIN_PASSWORD；删除 DEV_EMPLOYEE_CODE
# DATABASE_URL 不用改（compose 里指向 db 容器）

# 3. 起库 → 建表 → 种子 → 汇率 → 应用
docker compose up -d db
docker compose run --rm app sh -c "npx prisma db push && npx tsx prisma/seed.ts && npx tsx src/jobs/fetch-boc-rates.ts"
docker compose up -d app fx

# 4. 自检
curl -s http://localhost:3000/api/health
docker compose run --rm app npx tsx scripts/smoke.ts      # 用真实库跑十步
```

## 域名与 HTTPS（Caddy 两行）

```
# /etc/caddy/Caddyfile
opth.ducheng-industrial.com {
    reverse_proxy localhost:3000
}
```

`apt install caddy && systemctl restart caddy` — Caddy 自动申请证书。把 DNS A 记录指到这台主机即可切换。

## 日常

- 升级：`git pull && docker compose build app && docker compose up -d app`
- 备份：`docker compose exec db pg_dump -U dcit dcit_os | gzip > backup-$(date +%F).sql.gz`；`uploads` 卷里是报告 PDF
- 汇率任务 `fx` 容器每天抓一次中国银行牌价；Admin 页可查
- 首个账号：ETH2611001 / SEED_ADMIN_PASSWORD；登录后在 OPD 建其他员工（ETH 自动分配），在 CRM 给客户联系人开门户账号
