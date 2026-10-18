export async function uploadMedia(
  file: File,
  userId: string,
  kind: "products" | "logos"
): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg"
  const path = `${userId}/${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage
    .from("batchly-media")
    .upload(path, file, { contentType: file.type })
  if (error) throw error
  const { data } = supabase.storage.from("batchly-media").getPublicUrl(path)
  return data.publicUrl
}

import { supabase } from "@/lib/supabase"
