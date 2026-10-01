import "dotenv/config";
import { supabaseStorage } from "../src/lib/storage";

async function main() {
  console.log("Checking Supabase Storage buckets...");
  const { data: buckets, error: bError } = await supabaseStorage.storage.listBuckets();
  if (bError) {
    console.error("List buckets error:", bError);
  } else {
    console.log("Buckets:", buckets);
  }

  console.log("\nListing files in research-papers bucket root...");
  const { data: files, error: fError } = await supabaseStorage.storage.from("research-papers").list();
  if (fError) {
    console.error("List files error:", fError);
  } else {
    console.log("Files/Folders in research-papers:", files);
  }
}

main().catch(console.error);
