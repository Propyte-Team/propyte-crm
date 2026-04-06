"use client";

import { useState, useCallback } from "react";
import { EditableField } from "./editable-field";
import { ImageGallery } from "./image-gallery";

interface DetailField {
  key: string;
  label: string;
  zoho: boolean;
  web: boolean;
  isArray?: boolean;
}

interface EditPanelProps {
  sections: { title: string; fields: DetailField[] }[];
  record: Record<string, unknown>;
  entityType: "developer" | "development" | "unit";
  entityId: string;
  onSaved: () => void;
}

// Fields that are image-type (rendered by ImageGallery instead of EditableField)
const IMAGE_FIELDS = new Set(["fotos_desarrollo", "fotos_unidad", "logo", "plano_unidad"]);

export function EditPanel({ sections, record, entityType, entityId, onSaved }: EditPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedFields, setEditedFields] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleFieldChange = useCallback((key: string, value: unknown) => {
    setEditedFields((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleCancel = () => {
    setIsEditing(false);
    setEditedFields({});
    setError(null);
    setSuccess(false);
  };

  const handleSave = async () => {
    // Compute diff: only send changed fields
    const changedFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(editedFields)) {
      if (JSON.stringify(value) !== JSON.stringify(record[key])) {
        changedFields[key] = value;
      }
    }

    if (Object.keys(changedFields).length === 0) {
      setIsEditing(false);
      setEditedFields({});
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch("/api/zoho/approvals/edit", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: entityType,
          id: entityId,
          fields: changedFields,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Error al guardar");
      } else {
        setSuccess(true);
        setIsEditing(false);
        setEditedFields({});
        onSaved();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setSaving(false);
    }
  };

  const handleImagesChange = useCallback((fieldKey: string, newUrls: string[]) => {
    setEditedFields((prev) => ({ ...prev, [fieldKey]: newUrls }));
  }, []);

  const startEditing = () => {
    // Initialize editedFields with current values for all editable fields
    const initial: Record<string, unknown> = {};
    for (const section of sections) {
      for (const field of section.fields) {
        initial[field.key] = record[field.key];
      }
    }
    setEditedFields(initial);
    setIsEditing(true);
    setSuccess(false);
    setError(null);
  };

  const currentValues = isEditing ? editedFields : record;

  return (
    <div>
      {/* Edit toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {error && (
            <span className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">{error}</span>
          )}
          {success && (
            <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">Guardado correctamente</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <button
                onClick={handleCancel}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Guardando..." : "Guardar cambios"}
              </button>
            </>
          ) : (
            <button
              onClick={startEditing}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Editar
            </button>
          )}
        </div>
      </div>

      {/* Fields grid */}
      {isEditing ? (
        <div className="space-y-6 mb-6">
          {sections.map((section) => (
            <div key={section.title}>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
                {section.title}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {section.fields.map((field) => {
                  // Image fields → ImageGallery
                  if (IMAGE_FIELDS.has(field.key)) {
                    const isSingle = field.key === "logo" || field.key === "plano_unidad";
                    const images = Array.isArray(currentValues[field.key])
                      ? (currentValues[field.key] as string[])
                      : currentValues[field.key]
                        ? [String(currentValues[field.key])]
                        : [];

                    return (
                      <div key={field.key} className="col-span-full">
                        <label className="text-xs text-gray-500 mb-1 block">{field.label}</label>
                        <ImageGallery
                          images={images}
                          entityType={entityType}
                          entityId={entityId}
                          fieldName={field.key}
                          isSingle={isSingle}
                          onImagesChange={(urls) => handleImagesChange(field.key, urls)}
                        />
                      </div>
                    );
                  }

                  return (
                    <EditableField
                      key={field.key}
                      fieldKey={field.key}
                      label={field.label}
                      value={currentValues[field.key]}
                      onChange={handleFieldChange}
                      isEditing={true}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
