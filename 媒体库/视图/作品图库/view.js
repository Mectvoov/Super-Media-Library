await dv.view("媒体库/视图/主题");

const page = dv.current();

if (!page || page.note_type !== "media") {
  return;
}

const obsidian = window.__mediaLibraryObsidian || {};
const showNotice = message => {
  if (typeof obsidian.Notice === "function") new obsidian.Notice(message);
  else console.info(message);
};

// 图库按「图片组」组织：媒体库/图库/<作品>/<图片组>/xxx.png
// 目录就是唯一真相：每组是一个子目录，组名就是目录名，gallery 字段只是同步出来的镜像。
const galleryRoot = "媒体库/图库";
const galleryHeading = "## 图库";
const looseGroup = "未分组";
const imagePattern = /\.(png|jpe?g|webp|gif|avif|svg|bmp)$/i;
const embedPattern = /!\[\[([^\][|#\n]+)(?:[|#][^\]\n]*)?\]\]|!\[[^\]\n]*\]\(([^)\n]+)\)/g;

const linkText = value => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && typeof value.path === "string") return value.path;
  return String(value)
    .replace(/^!?\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .split("#")[0]
    .trim();
};

const toArray = value => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.array === "function") return value.array();
  return [value];
};

const resolveFile = link => {
  const path = linkText(link);
  if (!path) return null;
  const direct = app.vault.getAbstractFileByPath(path);
  if (direct) return direct;
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch (error) {
    decoded = path;
  }
  const decodedDirect = app.vault.getAbstractFileByPath(decoded);
  if (decodedDirect) return decodedDirect;
  return app.vault.getFiles().find(file => file.name === decoded || file.path.endsWith(`/${decoded}`)) || null;
};

const cleanName = (value, fallback = "图片") => String(value ?? "")
  .replace(/[\\/:*?"<>|#^[\]]/g, "-")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 64) || fallback;

// 每部作品一个目录：<source_id>-<标题>
const imageBaseName = () => {
  const title = String(page.title || page.file.name || "作品").trim();
  const sourceId = page.source_id ? String(page.source_id).trim() : "";
  const base = sourceId ? `${sourceId}-${title}` : title;
  return cleanName(base.replace(/\s+/g, " "), "作品图片");
};

const workFolder = `${galleryRoot}/${imageBaseName()}`;

// 图组按导入时间分割，精确到秒。目录名里时分秒用「-」分隔，显示时还原成冒号。
const pad = value => String(value).padStart(2, "0");
const stampGroup = (when = Date.now()) => {
  const now = new Date(when);
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
    + `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
};
// 目录名形如「2026-11-04 10-08-12」或「2026-11-04 10-08-12 剧照」，时间后面可以带组名。
const parseGroup = group => {
  const match = /^(\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2})(?:\s+(.*))?$/.exec(String(group || ""));
  if (!match) return null;
  return { stamp: match[1], name: (match[2] || "").trim() };
};
const isStampGroup = group => Boolean(parseGroup(group));
const groupLabel = group => {
  const parsed = parseGroup(group);
  if (!parsed) return group;
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2})-(\d{2})-(\d{2})$/.exec(parsed.stamp);
  const stamp = match ? `${match[1]} ${match[2]}:${match[3]}:${match[4]}` : parsed.stamp;
  return parsed.name ? `${stamp} · ${parsed.name}` : stamp;
};

const ensureFolder = async path => {
  if (app.vault.getAbstractFileByPath(path)) return;
  try {
    await app.vault.createFolder(path);
  } catch (error) {
    // 目录并发创建时忽略
  }
};

const groupFolder = async group => {
  await ensureFolder(galleryRoot);
  await ensureFolder(workFolder);
  const name = cleanName(group, looseGroup);
  const folder = `${workFolder}/${name}`;
  await ensureFolder(folder);
  return folder;
};

const groupOf = path => {
  const prefix = `${workFolder}/`;
  if (!path.startsWith(prefix)) return "";
  const rest = path.slice(prefix.length);
  const index = rest.indexOf("/");
  return index === -1 ? looseGroup : rest.slice(0, index);
};

const extensionOf = name => {
  const raw = String(name || "").split(".").pop() || "png";
  const clean = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!clean || clean === String(name || "").toLowerCase()) return "png";
  return clean === "jpeg" ? "jpg" : clean;
};

const fileBaseName = name => cleanName(String(name || "").replace(/\.[^.]+$/, ""), imageBaseName());

const naturalCompare = (left, right) => String(left).localeCompare(String(right), "zh-Hans-CN", { numeric: true });

const uniquePath = (folder, extension, base, skipPath) => {
  let candidate = `${folder}/${base}.${extension}`;
  let index = 2;
  while (candidate !== skipPath && app.vault.getAbstractFileByPath(candidate)) {
    candidate = `${folder}/${base}-${index}.${extension}`;
    index += 1;
  }
  return candidate;
};

// 扫描作品目录，得出「图片组 → 图片」的真实清单。
const scanGallery = () => {
  const folder = app.vault.getAbstractFileByPath(workFolder);
  if (!folder || !folder.children) return [];
  const entries = [];
  const walk = (dir, group) => {
    for (const child of dir.children || []) {
      if (child.children) {
        walk(child, child.name);
        continue;
      }
      if (imagePattern.test(child.path)) entries.push({ group, path: child.path });
    }
  };
  walk(folder, looseGroup);
  entries.sort((left, right) => {
    if (left.group !== right.group) {
      if (left.group === looseGroup) return -1;
      if (right.group === looseGroup) return 1;
      return left.group.localeCompare(right.group, "zh-Hans-CN");
    }
    return naturalCompare(left.path, right.path);
  });
  return entries.map(entry => entry.path);
};

// 目录里已经存在的图组（含还没放图的空组）——空组也要能显示出来。
const scanGroupFolders = () => {
  const folder = app.vault.getAbstractFileByPath(workFolder);
  if (!folder || !folder.children) return [];
  return folder.children.filter(child => child.children).map(child => child.name);
};

let galleryLinks = scanGallery();

const writeGallery = async links => {
  const target = app.vault.getAbstractFileByPath(page.file.path);
  if (!target) return;
  await app.fileManager.processFrontMatter(target, frontmatter => {
    frontmatter.gallery = links.map(path => `[[${path}]]`);
  });
};

// 让 frontmatter 里的 gallery 跟目录内容保持一致。
const refreshGallery = async ({ write = true } = {}) => {
  const next = scanGallery();
  const changed = next.join("|") !== galleryLinks.join("|");
  galleryLinks = next;
  if (changed && write) await writeGallery(galleryLinks);
  return changed;
};

const refreshPoster = path => {
  const container = document.querySelector(".media-work-poster");
  if (!container) return;
  const url = app.vault.adapter.getResourcePath(path);
  let image = container.querySelector("img");
  if (!image) {
    if (typeof container.empty === "function") container.empty();
    image = container.createEl("img");
    image.setAttr("alt", `${page.title || page.file.name}封面`);
  }
  image.setAttr("src", url);
};

const setCover = async path => {
  const target = app.vault.getAbstractFileByPath(page.file.path);
  if (!target) return;
  await app.fileManager.processFrontMatter(target, frontmatter => {
    frontmatter.cover = `[[${path}]]`;
  });
  refreshPoster(path);
  showNotice("已设为封面。");
};

// 从系统文件对话框选本地图片（或整个文件夹），选完直接拷进图库目录。
const pickExternalFiles = ({ directory = false } = {}) => new Promise(resolve => {
  const input = document.createElement("input");
  input.type = "file";
  if (directory) {
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  } else {
    input.accept = "image/*";
  }
  input.multiple = true;
  input.style.display = "none";
  document.body.appendChild(input);
  let settled = false;
  const finish = files => {
    if (settled) return;
    settled = true;
    input.remove();
    resolve(files);
  };
  input.addEventListener("change", () => finish(Array.from(input.files || [])));
  input.addEventListener("cancel", () => finish([]));
  // 取消时某些平台不触发 cancel，用窗口重新获得焦点兜底
  const onFocus = () => {
    window.removeEventListener("focus", onFocus);
    window.setTimeout(() => finish([]), 400);
  };
  window.addEventListener("focus", onFocus, { once: true });
  input.click();
});

// 拖进来的是文件夹时，递归展开成文件列表。
const filesFromDataTransfer = async dataTransfer => {
  const entries = [];
  for (const item of Array.from(dataTransfer.items || [])) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (!entries.length) return Array.from(dataTransfer.files || []);

  const collected = [];
  const walk = async entry => {
    if (entry.isFile) {
      const file = await new Promise(resolve => entry.file(resolve, () => resolve(null)));
      if (file) collected.push(file);
      return;
    }
    if (!entry.isDirectory) return;
    const reader = entry.createReader();
    const readBatch = () => new Promise(resolve => reader.readEntries(resolve, () => resolve([])));
    let batch = await readBatch();
    while (batch.length) {
      for (const child of batch) await walk(child);
      batch = await readBatch();
    }
  };
  for (const entry of entries) await walk(entry);
  return collected.length ? collected : Array.from(dataTransfer.files || []);
};

/**
 * 导入图片：每次导入都新开一个图组，组名是这次导入的时间（精确到秒）。
 * 传了 group 就放进那一组（组里的 ＋ 卡片用它），文件夹导入也按一次导入算一组。
 */
const importFiles = async (files, { group = "" } = {}) => {
  const list = Array.from(files || []).filter(item => /^image\//.test(item.type || "")
    || imagePattern.test(item.name || ""));
  if (!list.length) {
    showNotice("没有可导入的图片。");
    return [];
  }
  // 文件夹导入时按相对路径排序，组内顺序才稳定
  list.sort((left, right) => naturalCompare(left.webkitRelativePath || left.name || "", right.webkitRelativePath || right.name || ""));

  const targetGroup = group || stampGroup();
  const folder = await groupFolder(targetGroup);
  const added = [];
  for (const item of list) {
    const target = uniquePath(folder, extensionOf(item.name), fileBaseName(item.name), null);
    const buffer = await item.arrayBuffer();
    await app.vault.createBinary(target, buffer);
    added.push(target);
  }

  await refreshGallery();
  render();
  showNotice(added.length ? `已导入 ${added.length} 张图片。` : "没有新增图片。");
  return added;
};

// 早期图片直接放在图库根目录，先挪进这部作品的目录，后面再按时间归组。
const migrateLooseLinks = async () => {
  const root = app.vault.getAbstractFileByPath(galleryRoot);
  if (!root || !root.children) return false;
  const prefixName = imageBaseName();
  const candidates = root.children
    .filter(child => !child.children && imagePattern.test(child.path))
    .filter(child => toArray(page.gallery).map(linkText).includes(child.path)
      || child.basename.startsWith(prefixName));
  if (!candidates.length) return false;
  await ensureFolder(workFolder);
  let moved = false;
  for (const file of candidates) {
    const target = uniquePath(workFolder, extensionOf(file.name), fileBaseName(file.name), file.path);
    try {
      await app.fileManager.renameFile(file, target);
      moved = true;
    } catch (error) {
      // 移动失败就留在原处
    }
  }
  return moved;
};

// 图组一律以时间命名：散图按最早时间归一组，遗留的无时间组名也改成时间。
const normalizeGroups = async () => {
  const root = app.vault.getAbstractFileByPath(workFolder);
  if (!root || !root.children) return false;
  let changed = false;

  const loose = root.children.filter(child => !child.children && imagePattern.test(child.path));
  if (loose.length) {
    const earliest = Math.min(...loose.map(file => file.stat?.mtime ?? Date.now()));
    let name = stampGroup(earliest);
    let index = 2;
    while (app.vault.getAbstractFileByPath(`${workFolder}/${name}`)) {
      name = `${stampGroup(earliest)}-${index}`;
      index += 1;
    }
    const folder = `${workFolder}/${name}`;
    await ensureFolder(folder);
    for (const file of loose) {
      try {
        await app.fileManager.renameFile(file, `${folder}/${file.name}`);
        changed = true;
      } catch (error) {
        // 单张失败就跳过
      }
    }
  }

  for (const child of Array.from(root.children || [])) {
    if (!child.children || isStampGroup(child.name)) continue;
    const stamps = child.children
      .filter(file => !file.children)
      .map(file => file.stat?.mtime ?? Date.now());
    if (!stamps.length) continue;
    const name = stampGroup(Math.min(...stamps));
    if (app.vault.getAbstractFileByPath(`${workFolder}/${name}`)) continue;
    try {
      await app.fileManager.renameFile(child, `${workFolder}/${name}`);
      changed = true;
    } catch (error) {
      // 重命名失败就保留原名
    }
  }
  return changed;
};

const section = dv.container.createDiv({ cls: "media-work-gallery" });
const header = section.createDiv({ cls: "media-gallery-toolbar" });
const countEl = header.createSpan({ cls: "media-gallery-count" });
const actions = header.createDiv({ cls: "media-gallery-actions" });
const importButton = actions.createEl("button", { cls: "media-gallery-add", text: "导入图片" });
const groupButton = actions.createEl("button", { cls: "media-gallery-add is-secondary", text: "导入图组" });
const emptyGroupButton = actions.createEl("button", { cls: "media-gallery-add is-secondary", text: "新建图组" });
emptyGroupButton.setAttr("title", "先建一个空图组，稍后再往里放图");
const groupsWrap = section.createDiv({ cls: "media-gallery-groups" });
const hint = section.createDiv({ cls: "media-gallery-hint" });

const groupedLinks = () => {
  const map = new Map();
  for (const path of galleryLinks) {
    const group = groupOf(path) || looseGroup;
    if (!map.has(group)) map.set(group, []);
    map.get(group).push(path);
  }
  return map;
};

// 时间组新的在前；没有时间戳的「未分组」压在最后。
const groupOrder = map => Array.from(map.keys()).sort((left, right) => {
  const rank = group => (isStampGroup(group) ? 0 : 1);
  if (rank(left) !== rank(right)) return rank(left) - rank(right);
  return right.localeCompare(left, "zh-Hans-CN");
});

// 取一个文本输入（Obsidian 的 window.prompt 在 Electron 里不可用，这里自己开弹窗）。
const askText = (title, placeholder, initial = "") => new Promise(resolve => {
  const ModalClass = obsidian.Modal;
  if (typeof ModalClass !== "function") {
    resolve(null);
    return;
  }
  const modal = new ModalClass(app);
  modal.titleEl.setText(title);
  const input = modal.contentEl.createEl("input", {
    type: "text",
    cls: "media-gallery-name-input",
    attr: { placeholder },
  });
  input.value = initial;
  const row = modal.contentEl.createDiv({ cls: "media-gallery-name-actions" });
  const cancel = row.createEl("button", { text: "取消" });
  const confirm = row.createEl("button", { text: "确定", cls: "mod-cta" });
  let done = false;
  const finish = value => {
    if (done) return;
    done = true;
    modal.close();
    resolve(value);
  };
  cancel.addEventListener("click", () => finish(null));
  confirm.addEventListener("click", () => finish(input.value));
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") finish(input.value);
    else if (event.key === "Escape") finish(null);
  });
  modal.onClose = () => {
    if (done) return;
    done = true;
    resolve(null);
  };
  modal.open();
  window.setTimeout(() => input.focus(), 50);
});

// 组名只改目录名：时间戳保留，名字接在后面。
const renameGroup = async (group, name) => {
  const parsed = parseGroup(group);
  const base = parsed ? parsed.stamp : group;
  const clean = name ? cleanName(name, "") : "";
  const target = clean ? `${base} ${clean}` : base;
  if (target === group) return group;
  const folder = app.vault.getAbstractFileByPath(`${workFolder}/${group}`);
  if (!folder || !folder.children) return group;
  if (app.vault.getAbstractFileByPath(`${workFolder}/${target}`)) {
    showNotice("这个组名已经用过了。");
    return group;
  }
  try {
    await app.fileManager.renameFile(folder, `${workFolder}/${target}`);
    return target;
  } catch (error) {
    showNotice("重命名失败。");
    return group;
  }
};

// 移除就是删图：进 Obsidian 回收站（受「删除文件」设置约束）。
const removeImage = async path => {
  const file = app.vault.getAbstractFileByPath(path);
  if (!file) return;
  if (typeof app.fileManager.trashFile === "function") {
    await app.fileManager.trashFile(file);
    return;
  }
  await app.vault.delete(file, true);
};

const renderCard = (grid, path) => {
  const file = resolveFile(path);
  const card = grid.createDiv({ cls: "media-gallery-card" });
  card.setAttr("title", path);

  if (file && imagePattern.test(file.path)) {
    const image = card.createEl("img", { cls: "media-gallery-image" });
    image.setAttr("src", app.vault.adapter.getResourcePath(file.path));
    image.setAttr("alt", file.basename);
    image.setAttr("loading", "lazy");
    image.addEventListener("click", () => {
      app.workspace.getLeaf("tab").openFile(file);
    });
  } else {
    card.createDiv({ cls: "media-gallery-missing", text: "文件缺失" });
  }

  const cardActions = card.createDiv({ cls: "media-gallery-card-actions" });
  const coverButton = cardActions.createEl("button", { cls: "media-gallery-action", text: "设为封面" });
  coverButton.addEventListener("click", async () => {
    coverButton.disabled = true;
    await setCover(path);
    coverButton.disabled = false;
  });
  const removeButton = cardActions.createEl("button", { cls: "media-gallery-action is-danger", text: "移除" });
  removeButton.addEventListener("click", async () => {
    removeButton.disabled = true;
    await removeImage(path);
    await refreshGallery();
    render();
    showNotice("已从图库移除并删除图片。");
  });
};

// 组内添加：可以加单张/多张图，也可以加一个文件夹（并入当前组）。
const chooseSource = (event, onImages, onFolder) => {
  const MenuClass = obsidian.Menu;
  if (typeof MenuClass !== "function" || !event) {
    onImages();
    return;
  }
  const menu = new MenuClass();
  menu.addItem(item => item.setTitle("添加图片").setIcon("image").onClick(() => onImages()));
  menu.addItem(item => item.setTitle("添加文件夹").setIcon("folder").onClick(() => onFolder()));
  menu.showAtMouseEvent(event);
};

const addTile = (grid, group, empty = false) => {
  const tile = grid.createDiv({ cls: `media-gallery-card is-add${empty ? " is-empty" : ""}` });
  tile.createDiv({ cls: "media-gallery-add-plus", text: "＋" });
  if (empty) {
    tile.createDiv({ cls: "media-gallery-add-label", text: "添加图组" });
    tile.createDiv({ cls: "media-gallery-add-sub", text: "选图片或文件夹，按导入时间成组" });
  }
  tile.setAttr("title", group ? `向「${group}」添加图片` : "导入图片组");
  tile.addEventListener("click", event => {
    const target = empty ? "" : group;
    const addImages = async () => {
      const picked = await pickExternalFiles();
      if (!picked.length) return;
      await importFiles(picked, { group: target });
    };
    const addFolder = async () => {
      const picked = await pickExternalFiles({ directory: true });
      if (!picked.length) return;
      await importFiles(picked, { group: target });
    };
    chooseSource(event, addImages, addFolder);
  });
};

// 折叠状态按作品记在浏览器里，重新打开笔记还保持。
const collapsedKey = `media-gallery-collapsed::${workFolder}`;
const loadCollapsed = () => {
  try {
    const raw = window.localStorage.getItem(collapsedKey);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch (error) {
    return new Set();
  }
};
const collapsedGroups = loadCollapsed();
const saveCollapsed = () => {
  try {
    window.localStorage.setItem(collapsedKey, JSON.stringify(Array.from(collapsedGroups)));
  } catch (error) {
    // 存不进去也不影响这次会话
  }
};

const renderGroup = (group, paths) => {
  const block = groupsWrap.createDiv({ cls: "media-gallery-group" });
  // 把文件拖到某一组上，就直接并进这一组
  block.addEventListener("dragover", event => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    block.addClass("is-drop-target");
  });
  block.addEventListener("dragleave", event => {
    if (event.relatedTarget && block.contains(event.relatedTarget)) return;
    block.removeClass("is-drop-target");
  });
  block.addEventListener("drop", async event => {
    if (!event.dataTransfer) return;
    // 必须在 await 之前截住冒泡，否则外层也会当成新图组再导入一次
    event.preventDefault();
    event.stopPropagation();
    block.removeClass("is-drop-target");
    const dropped = await filesFromDataTransfer(event.dataTransfer);
    if (!dropped.length) return;
    await importFiles(dropped, { group });
  });
  const groupHeader = block.createDiv({ cls: "media-gallery-group-header" });
  const toggle = groupHeader.createSpan({ cls: "media-gallery-group-toggle" });
  groupHeader.createSpan({ cls: "media-gallery-group-name", text: groupLabel(group) });
  groupHeader.createSpan({ cls: "media-gallery-group-count", text: `${paths.length} 张` });

  // 按钮只放图标，省地方；文字放进 tooltip。两个按钮挤在一组，一起贴在右侧。
  const groupActions = groupHeader.createDiv({ cls: "media-gallery-group-actions" });
  const iconButton = (parent, icon, label) => {
    const button = parent.createEl("button", { cls: "media-gallery-group-action" });
    button.setAttr("aria-label", label);
    button.setAttr("title", label);
    if (typeof obsidian.setIcon === "function") {
      obsidian.setIcon(button, icon);
    } else {
      button.setText(label);
      button.addClass("has-text");
    }
    return button;
  };

  // 复制这一组的存放位置：只指到组，不列具体图片。
  const linkButton = iconButton(groupActions, "link", "复制这一组的路径");
  linkButton.addEventListener("click", async () => {
    const folder = `${workFolder}/${group}`;
    try {
      await navigator.clipboard.writeText(folder);
      showNotice(`已复制图组路径：${folder}`);
    } catch (error) {
      showNotice(folder);
    }
  });

  const renameButton = iconButton(groupActions, "pencil", "给这一组命名");
  renameButton.addEventListener("click", async () => {
    const parsed = parseGroup(group);
    const value = await askText("图组名称", "例如：剧照、设定图", parsed ? parsed.name : "");
    if (value === null) return;
    const next = await renameGroup(group, value.trim());
    await refreshGallery();
    render();
    if (next !== group) showNotice(`已命名为「${groupLabel(next)}」。`);
  });

  const removeGroup = iconButton(groupActions, "trash-2", "移除整组并删除图片");
  removeGroup.addEventListener("click", async () => {
    removeGroup.disabled = true;
    for (const path of paths) await removeImage(path);
    const folder = app.vault.getAbstractFileByPath(`${workFolder}/${group}`);
    if (folder && !(folder.children || []).length) await app.vault.delete(folder, true);
    await refreshGallery();
    render();
    showNotice(`已移除「${groupLabel(group)}」并删除其中的图片。`);
  });

  const grid = block.createDiv({ cls: "media-gallery-grid" });
  for (const path of paths) renderCard(grid, path);
  addTile(grid, group);

  const applyCollapsed = () => {
    const isCollapsed = collapsedGroups.has(group);
    block.toggleClass("is-collapsed", isCollapsed);
    // hidden 属性会被 .media-gallery-grid 的 display:grid 盖掉，所以用 class 控制
    grid.toggleClass("is-collapsed", isCollapsed);
    grid.hidden = isCollapsed;
    if (typeof obsidian.setIcon === "function") {
      obsidian.setIcon(toggle, isCollapsed ? "chevron-right" : "chevron-down");
    } else {
      toggle.setText(isCollapsed ? "▸" : "▾");
    }
  };
  // 只有图标本身能折叠，标题文字不响应
  toggle.setAttr("title", "收起或展开这一组");
  toggle.setAttr("aria-label", "收起或展开这一组");
  toggle.addEventListener("click", () => {
    if (collapsedGroups.has(group)) collapsedGroups.delete(group);
    else collapsedGroups.add(group);
    saveCollapsed();
    applyCollapsed();
  });
  applyCollapsed();
};

// 新建一个空图组：没有图也能先占个位置，之后往里放。
const createEmptyGroup = async () => {
  const value = await askText("新建图组", "组名可以留空，之后再命名", "");
  if (value === null) return;
  const name = value.trim() ? cleanName(value.trim(), "") : "";
  // 同一秒内连点两次会撞名，往后顺延一秒
  let when = Date.now();
  let group = name ? `${stampGroup(when)} ${name}` : stampGroup(when);
  while (app.vault.getAbstractFileByPath(`${workFolder}/${group}`)) {
    when += 1000;
    group = name ? `${stampGroup(when)} ${name}` : stampGroup(when);
  }
  try {
    await groupFolder(group);
  } catch (error) {
    showNotice("新建图组失败。");
    return;
  }
  if (collapsedGroups.has(group)) {
    collapsedGroups.delete(group);
    saveCollapsed();
  }
  await refreshGallery();
  render();
  showNotice(`已新建图组「${groupLabel(group)}」。`);
};

const render = () => {
  Array.from(groupsWrap.children).forEach(child => child.remove());
  const map = groupedLinks();
  // 空组在目录里存在但 gallery 里没有图，也要列出来
  for (const group of scanGroupFolders()) if (!map.has(group)) map.set(group, []);
  const totalGroups = map.size;
  countEl.setText(galleryLinks.length || totalGroups
    ? `${galleryLinks.length} 张 · ${totalGroups} 组`
    : "");

  if (!galleryLinks.length && !totalGroups) {
    const block = groupsWrap.createDiv({ cls: "media-gallery-group" });
    addTile(block.createDiv({ cls: "media-gallery-grid" }), "", true);
  } else {
    for (const group of groupOrder(map)) renderGroup(group, map.get(group));
  }

  hint.setText(`每次导入都会按时间（精确到秒）新建一个图组，也可以点「新建图组」先建个空组、之后再往里放图；点「命名」能在时间后面加名字；移除会删除图片。也可以把图片或文件夹直接拖到这里。`);
};

// 粘贴到「## 图库」一节的图片：按这次粘贴的时间新建一组
let syncing = false;

const placePastedImage = async (file, group) => {
  if (!file || !imagePattern.test(file.path)) return null;
  const folder = await groupFolder(group);
  const extension = extensionOf(file.name);
  if (file.path.startsWith(`${folder}/`)) {
    if (!/^pasted[ _-]?image/i.test(file.basename)) return file.path;
    const renamed = uniquePath(folder, extension, imageBaseName(), file.path);
    try {
      await app.fileManager.renameFile(file, renamed);
      return renamed;
    } catch (error) {
      return file.path;
    }
  }
  const target = uniquePath(folder, extension, imageBaseName(), null);
  const data = await app.vault.readBinary(file);
  await app.vault.createBinary(target, data);
  return target;
};

const sectionBounds = text => {
  const lines = text.split("\n");
  const start = lines.findIndex(line => line.trim() === galleryHeading);
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,2}\s/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { lines, start, end };
};

const embedTokens = text => {
  const tokens = [];
  for (const match of text.matchAll(embedPattern)) {
    const token = (match[1] || match[2] || "").trim();
    if (token) tokens.push(token);
  }
  return tokens;
};

const syncNoteImages = async () => {
  if (syncing) return;
  const target = app.vault.getAbstractFileByPath(page.file.path);
  if (!target) return;
  const text = await app.vault.read(target);
  const bounds = sectionBounds(text);
  if (!bounds) return;

  const sectionText = bounds.lines.slice(bounds.start + 1, bounds.end).join("\n");
  const tokens = embedTokens(sectionText);
  if (!tokens.length) return;

  const captured = new Set();
  const group = stampGroup();
  for (const token of tokens) {
    if (captured.has(token)) continue;
    const source = resolveFile(token);
    if (!source) continue;
    const placed = await placePastedImage(source, group);
    if (!placed) continue;
    captured.add(token);
  }

  if (!captured.size) return;

  syncing = true;
  try {
    const rewritten = [];
    let lastBlank = false;
    for (let index = 0; index < bounds.lines.length; index += 1) {
      const line = bounds.lines[index];
      if (index <= bounds.start || index >= bounds.end) {
        rewritten.push(line);
        lastBlank = false;
        continue;
      }
      const hadEmbed = /!\[\[|!\[[^\]]*\]\(/.test(line);
      const stripped = line
        .replace(embedPattern, match => {
          const inner = match
            .replace(/^!\[\[/, "")
            .replace(/\]\]$/, "")
            .replace(/^!\[[^\]]*\]\(/, "")
            .replace(/\)$/, "");
          const clean = inner.split("|")[0].split("#")[0].trim();
          return captured.has(clean) || captured.has(inner.trim()) ? "" : match;
        })
        .trimEnd();
      if (stripped.trim() === "") {
        if (hadEmbed || lastBlank) continue;
        lastBlank = true;
        rewritten.push("");
        continue;
      }
      lastBlank = false;
      rewritten.push(hadEmbed ? stripped.replace(/[ \t]{2,}/g, " ") : stripped);
    }
    const nextText = rewritten.join("\n");
    if (nextText !== text) await app.vault.modify(target, nextText);
    const changed = await refreshGallery();
    if (changed) render();
  } finally {
    syncing = false;
  }
};

const importFromComputer = async ({ directory = false } = {}) => {
  const files = await pickExternalFiles({ directory });
  if (!files.length) return;
  await importFiles(files);
};

importButton.addEventListener("click", () => importFromComputer());
groupButton.addEventListener("click", () => importFromComputer({ directory: true }));
emptyGroupButton.addEventListener("click", () => createEmptyGroup());

// 从系统拖文件进来也走导入
section.addEventListener("dragover", event => {
  if (!event.dataTransfer?.types?.includes("Files")) return;
  event.preventDefault();
  section.addClass("is-drop-target");
});
section.addEventListener("dragleave", event => {
  if (event.relatedTarget && section.contains(event.relatedTarget)) return;
  section.removeClass("is-drop-target");
});
section.addEventListener("drop", async event => {
  if (!event.dataTransfer) return;
  const dropped = await filesFromDataTransfer(event.dataTransfer);
  if (!dropped.length) return;
  event.preventDefault();
  section.removeClass("is-drop-target");
  await importFiles(dropped);
});

const start = async () => {
  await migrateLooseLinks();
  await normalizeGroups();
  await refreshGallery();
  render();
  await syncNoteImages();
};

start().catch(error => console.warn("图库初始化失败", error));

const watchers = window.__mediaLibraryGalleryWatchers
  || (window.__mediaLibraryGalleryWatchers = new Map());
const watchKey = page.file.path;
if (!watchers.has(watchKey)) {
  let timer = null;
  const ref = app.vault.on("modify", file => {
    if (file.path !== watchKey) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      syncNoteImages().catch(error => console.warn("图库同步失败", error));
    }, 600);
  });
  watchers.set(watchKey, () => {
    window.clearTimeout(timer);
    app.vault.offref(ref);
    watchers.delete(watchKey);
  });
}
