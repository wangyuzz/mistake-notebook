import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  Camera,
  ImagePlus,
  LoaderCircle,
  Plus,
  ZoomIn,
  BookOpen,
  ArrowUpRight,
} from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { imageFromFile } from "./lib";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={"modal " + (wide ? "modal-wide " : "") + className}
          onOpenAutoFocus={(e) => {
            if (window.innerWidth < 640) e.preventDefault();
          }}
        >
          <header className="modal-header">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description className={description ? "" : "sr-only"}>
                {description || title}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="关闭">
              <X size={21} />
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Spinner({ size = 18 }: { size?: number }) {
  return <LoaderCircle className="spin" size={size} />;
}
export function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <BookOpen size={30} strokeWidth={1.3} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Upload({
  label,
  images,
  onChange,
  notify,
}: {
  label: string;
  images: string[];
  onChange: (v: string[]) => void;
  notify: (s: string) => void;
}) {
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function handle(files: FileList | null) {
    if (!files?.length) return;
    if (images.length + files.length > 4) {
      notify("每组最多放 4 张图片");
      return;
    }
    setBusy(true);
    try {
      const added = await Promise.all(Array.from(files).map(imageFromFile));
      onChange([...images, ...added]);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
      if (gallery.current) gallery.current.value = "";
      if (camera.current) camera.current.value = "";
    }
  }
  return (
    <div className="upload-section">
      <div className="field-label">
        {label}
        <span>{images.length}/4</span>
      </div>
      <div className="upload-zone">
        {images.length > 0 && (
          <div className="upload-previews">
            {images.map((src, i) => (
              <div key={i}>
                <img src={src} alt={label + " " + (i + 1)} />
                <button
                  type="button"
                  onClick={() => onChange(images.filter((_, j) => j !== i))}
                  aria-label={"移除" + label + (i + 1)}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="upload-actions">
          <button
            type="button"
            disabled={busy || images.length >= 4}
            onClick={() => camera.current?.click()}
          >
            <Camera size={21} />
            <span>拍照录入</span>
          </button>
          <span className="upload-divider" />
          <button
            type="button"
            disabled={busy || images.length >= 4}
            onClick={() => gallery.current?.click()}
          >
            {busy ? <Spinner size={21} /> : <ImagePlus size={21} />}
            <span>{busy ? "正在处理" : "上传图片"}</span>
          </button>
        </div>
        <small>支持 JPG / PNG / WebP，自动压缩清晰保存</small>
      </div>
      <input
        className="sr-only"
        ref={gallery}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={(e) => void handle(e.target.files)}
        aria-label={"上传" + label}
      />
      <input
        className="sr-only"
        ref={camera}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        onChange={(e) => void handle(e.target.files)}
        aria-label={"拍摄" + label}
      />
    </div>
  );
}
export function Photo({
  src,
  alt,
  onZoom,
}: {
  src: string;
  alt: string;
  onZoom: (s: string) => void;
}) {
  return (
    <button className="detail-photo" onClick={() => onZoom(src)}>
      <img src={src} alt={alt} />
      <span>
        <ZoomIn size={14} />
        查看原图
      </span>
    </button>
  );
}
export function BookIllustration() {
  return (
    <svg
      className="book-illustration"
      viewBox="0 0 300 220"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="157"
        cy="113"
        r="95"
        stroke="currentColor"
        strokeOpacity=".12"
      />
      <circle
        cx="157"
        cy="113"
        r="72"
        stroke="currentColor"
        strokeOpacity=".12"
      />
      <path
        d="m76 69 111-22 43 107-112 27z"
        fill="#183e32"
        stroke="#91a98b"
        strokeWidth="1.2"
      />
      <path d="m69 61 110-22 43 107-110 27z" fill="#e5e8cc" />
      <path d="m79 58 101-20 43 107-101 20z" fill="#f7f3e5" />
      <path d="m113 51 14 37 10-10 13 5-14-37" fill="#dcab7f" />
      <path
        d="m103 112 73-15m-67 29 55-11m-48 25 68-14"
        stroke="#b2bea3"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="m212 57 14-7m-3 21 13 1M74 139l-14 4m18 8-4 12"
        stroke="#d6dfb3"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="63" cy="80" r="4" fill="#d6dfb3" />
      <path
        d="m198 169 5 10 10 1-8 7 2 11-9-6-10 5 3-11-7-8 11-1z"
        fill="#dcab7f"
      />
      <path d="m231 113 7 3 1 8 5-6 8 1-4-7 3-8-8 2-6-5z" fill="#d6dfb3" />
    </svg>
  );
}
export function AddButton({
  onClick,
  small = false,
}: {
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      className={"button primary " + (small ? "button-small" : "")}
      onClick={onClick}
    >
      <Plus size={18} />
      <span>收录错题</span>
    </button>
  );
}
export function SectionHeading({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>
          {title}
          <span className="title-dot">.</span>
        </h1>
      </div>
      {action}
    </div>
  );
}
export function LinkArrow() {
  return <ArrowUpRight size={16} />;
}
