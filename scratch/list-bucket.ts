import "./load-env";
import { supabaseStorage } from "../src/lib/storage";

async function main() {
  const { data, error } = await supabaseStorage.storage.from("research-papers").list();
  if (error) {
    console.error("Storage list error:", error);
    return;
  }
  console.log("Bucket root items:", data?.length);
  for (const item of data || []) {
    console.log(`- Item: ${item.name}, id=${item.id}`);
    const sub = await supabaseStorage.storage.from("research-papers").list(item.name);
    for (const f of sub.data || []) {
      console.log(`    File: ${f.name}, metadata:`, f.metadata);
    }
  }
}

main().catch(console.error);
