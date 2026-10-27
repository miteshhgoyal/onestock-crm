import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, FolderOpen, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { formatTeamDateTime } from "@/lib/constants";

const MAX_SIZE = 15 * 1024 * 1024;
const ACCEPT = ".pdf,.txt,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

const formatSize = (size) => {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = formatTeamDateTime;

export default function Documents() {
  const inputRef = useRef(null);
  const [items, setItems] = useState([]);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/documents");
      setItems(data);
    } catch (e) { toast.error(errMsg(e)); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_SIZE) return toast.error("Document must be 15 MB or smaller");
    const body = new FormData();
    body.append("file", file);
    setUploading(true);
    try {
      await api.post("/documents", body, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Document uploaded");
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setUploading(false); }
  };

  const download = async (item) => {
    try {
      const { data } = await api.get(`/documents/${item.id}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = item.name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error(errMsg(e)); }
  };

  const remove = async (item) => {
    try {
      await api.delete(`/documents/${item.id}`);
      toast.success("Document deleted");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div className="px-5 py-6 lg:px-8" data-testid="documents-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm text-muted-foreground">Sales workspace</div>
          <h1 className="display mt-1 text-3xl font-black tracking-tight">Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">Keep proposals, scripts, brochures, and team files in one place.</p>
        </div>
        <div>
          <input ref={inputRef} type="file" accept={ACCEPT} onChange={upload} className="hidden" data-testid="document-file-input" />
          <Button data-testid="upload-document-button" onClick={() => inputRef.current?.click()} disabled={uploading} className="bg-[#247e9d] text-white hover:bg-[#15556b]">{uploading ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Upload size={15} className="mr-2" />}Upload document</Button>
        </div>
      </div>

      <div className="mt-7 flex items-center gap-3 rounded-lg border border-dashed border-[#26758d] bg-[#102b3c] px-5 py-4 text-sm text-[#a9e8f5]"><FolderOpen size={19} /><span>Accepted: PDF, Word, Excel, PowerPoint, text, PNG, and JPG. Maximum file size: 15 MB.</span></div>

      <div className="mt-5 overflow-hidden rounded-lg border border-border/70 bg-[#101d32]" data-testid="documents-list">
        <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_auto] gap-4 border-b border-border/70 bg-[#162640] px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground"><span>Name</span><span>Uploaded by</span><span>Added</span><span>Actions</span></div>
        {items.map((item) => <div key={item.id} className="grid grid-cols-[minmax(0,1.7fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_auto] items-center gap-4 border-b border-border/60 px-5 py-4 last:border-0"><div className="flex min-w-0 items-center gap-3"><div className="rounded-md bg-[#e5f4f6] p-2 text-[#247e9d]"><FileText size={17} /></div><div className="min-w-0"><div className="truncate text-sm font-semibold">{item.name}</div><div className="text-xs text-muted-foreground">{formatSize(item.size)} · {item.content_type.split("/").pop()}</div></div></div><span className="truncate text-sm text-muted-foreground">{item.owner_name || "—"}</span><span className="text-xs text-muted-foreground">{formatDate(item.created_at)}</span><div className="flex items-center gap-1"><button title="Download document" aria-label={`Download ${item.name}`} onClick={() => download(item)} className="rounded-md p-2 text-[#247e9d] hover:bg-[#eff9fa]"><Download size={16} /></button><button title="Delete document" aria-label={`Delete ${item.name}`} onClick={() => remove(item)} className="rounded-md p-2 text-red-500 hover:bg-red-50"><Trash2 size={16} /></button></div></div>)}
        {!items.length && <div className="px-5 py-16 text-center text-sm text-muted-foreground"><FileText className="mx-auto mb-3 text-[#247e9d]" size={26} />No documents uploaded yet.</div>}
      </div>
    </div>
  );
}
