// Gathers audio/video files from a file picker or a drop, keeping the folders they came in.

const MEDIA = /\.(mp3|m4a|wav|aac|ogg|oga|opus|flac|mp4|m4v|mov|webm|mkv)$/i;

export const isMediaFile = file => /^(audio|video)\//.test(file.type) || MEDIA.test(file.name);

// From <input type=file multiple> (or webkitdirectory, which fills webkitRelativePath).
export function filesFromInput(fileList) {
  return [...fileList].map(file => {
    const parts = (file.webkitRelativePath || '').split('/').filter(Boolean);
    return { file, dirs: parts.slice(0, -1) };
  });
}

// From a drop. Directory entries must be taken during the drop event itself;
// reading them can happen afterwards.
export function entriesFromDrop(dataTransfer) {
  const entries = [...(dataTransfer.items ?? [])]
    .filter(item => item.kind === 'file')
    .map(item => item.webkitGetAsEntry?.())
    .filter(Boolean);
  const plain = entries.length ? null : [...dataTransfer.files];
  return async () => {
    if (plain) return plain.map(file => ({ file, dirs: [] }));
    const out = [];
    const walk = async (entry, dirs) => {
      if (entry.isFile) {
        out.push({ file: await new Promise((resolve, reject) => entry.file(resolve, reject)), dirs });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        for (;;) {
          const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
          if (!batch.length) break;
          for (const child of batch) await walk(child, [...dirs, entry.name]);
        }
      }
    };
    for (const entry of entries) await walk(entry, []);
    return out;
  };
}

export const titleOf = file => file.name.replace(/\.[^.]+$/, '');
