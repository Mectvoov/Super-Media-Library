#!/bin/bash
# 双击运行：把 vault 里的改动打包成一次提交，并说明改了什么。
# 放在 .scripts/ 里，不参与 dataview 渲染。

set -u
cd "$(dirname "$0")/.." || exit 1

echo "=== 检查改动 ==="
git add -A

if git diff --cached --quiet; then
  echo "没有需要提交的改动。"
  read -r -p "按回车关闭窗口..."
  exit 0
fi

echo
echo "将要提交的文件："
git diff --cached --name-status | sed 's/^/  /'

echo
echo "改动规模：$(git diff --cached --shortstat | sed 's/^ *//')"

# 用改动文件自动拼一句默认说明：按目录归类，最多列 4 项。
default_msg=$(
  git diff --cached --name-only |
  awk -F/ '{
    if ($1 == ".obsidian") { key = ".obsidian 设置" }
    else if (NF >= 3) { key = $1 "/" $2 }
    else if (NF == 2) { key = $1 "/" $2 }
    else { key = $0 }
    print key
  }' |
  awk '!seen[$0]++' |
  head -4 |
  paste -sd '、' -
)

cat <<EOF

=== 这次改了什么 ===
请用一句话说明（例如：图库加折叠、首页改配色、新增作品《xxx》）
直接回车则使用默认说明：更新 ${default_msg}
EOF

read -r -p "> " msg
if [ -z "${msg}" ]; then
  msg="更新 ${default_msg}"
fi

git commit -q -m "${msg}" || { echo "提交失败。"; read -r -p "按回车关闭窗口..."; exit 1; }
echo
echo "已提交：$(git log --oneline -1)"

echo
read -r -p "现在推送到 GitHub 吗？[Y/n] " answer
case "${answer:-Y}" in
  [Nn]*) echo "已跳过推送。"; read -r -p "按回车关闭窗口..."; exit 0 ;;
esac

if git push; then
  echo "推送完成。"
else
  echo
  echo "推送失败。常见原因："
  echo "  1. github.com:443 连不上（可以先测：curl -m 8 -o /dev/null -w '%{http_code}' https://github.com）"
  echo "  2. 需要重新登录（HTTPS 用户名填 GitHub 用户名，密码位置粘贴 token）"
fi

read -r -p "按回车关闭窗口..."
