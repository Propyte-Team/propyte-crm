-- Frente 2: media en el inbox — columnas de media en messages (additiva, idempotente)
-- Autorizada por Luis 2026-07-13 ("Aplica la migración de columnas de media en messages a la Supabase de prod")
-- Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm)

ALTER TABLE propyte_crm.messages ADD COLUMN IF NOT EXISTS "mediaType" TEXT;
ALTER TABLE propyte_crm.messages ADD COLUMN IF NOT EXISTS "mediaFilename" TEXT;
ALTER TABLE propyte_crm.messages ADD COLUMN IF NOT EXISTS "mediaMimeType" TEXT;

-- Bucket privado para media de chat (autorizado: "Crea el bucket privado chat-media en la Supabase de prod")
-- file_size_limit 100MB (tope documento WhatsApp). Sin policies: acceso solo por service role + signed URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-media', 'chat-media', false, 104857600)
ON CONFLICT (id) DO NOTHING;
