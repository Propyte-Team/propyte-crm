"use client";

import { useState, useRef } from "react";

interface ImageGalleryProps {
  images: string[];
  entityType: "developer" | "development" | "unit";
  entityId: string;
  fieldName: string;
  isSingle?: boolean;
  onImagesChange: (urls: string[]) => void;
}

export function ImageGallery({
  images,
  entityType,
  entityId,
  fieldName,
  isSingle = false,
  onImagesChange,
}: ImageGalleryProps) {
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("entity_type", entityType);
      formData.append("entity_id", entityId);
      formData.append("field_name", fieldName);

      for (const file of Array.from(files)) {
        formData.append("files", file);
      }

      const res = await fetch("/api/zoho/approvals/upload-image", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Error al subir");
      } else {
        // Update parent with new URLs
        if (isSingle) {
          onImagesChange(data.urls);
        } else {
          onImagesChange([...images, ...data.urls]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (imageUrl: string) => {
    if (!confirm("Eliminar esta imagen?")) return;

    setDeleting(imageUrl);
    setError(null);

    try {
      const res = await fetch("/api/zoho/approvals/delete-image", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: entityId,
          field_name: fieldName,
          image_url: imageUrl,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Error al eliminar");
      } else {
        onImagesChange(images.filter((url) => url !== imageUrl));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      {error && (
        <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded mb-2">{error}</div>
      )}

      {/* Image grid */}
      <div className="flex flex-wrap gap-3 mb-3">
        {images.map((url) => (
          <div key={url} className="relative group">
            <button
              type="button"
              onClick={() => setPreviewUrl(url)}
              className="block w-24 h-24 rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 transition-colors"
            >
              <img
                src={url}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
            {/* Delete button */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleDelete(url); }}
              disabled={deleting === url}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 disabled:opacity-50"
              title="Eliminar imagen"
            >
              {deleting === url ? "..." : "\u00d7"}
            </button>
          </div>
        ))}

        {/* Upload button */}
        {(!isSingle || images.length === 0) && (
          <label className={`w-24 h-24 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              multiple={!isSingle}
              onChange={handleUpload}
              className="hidden"
            />
            {uploading ? (
              <span className="text-xs text-gray-400">Subiendo...</span>
            ) : (
              <>
                <span className="text-2xl text-gray-400">+</span>
                <span className="text-[10px] text-gray-400 mt-0.5">Subir imagen</span>
              </>
            )}
          </label>
        )}
      </div>

      {images.length === 0 && !uploading && (
        <p className="text-xs text-gray-400 italic">Sin imágenes</p>
      )}

      {/* Preview modal */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img
              src={previewUrl}
              alt=""
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
            />
            <button
              onClick={() => setPreviewUrl(null)}
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70"
            >
              {"\u00d7"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
