import { redirect } from "next/navigation";

// The broker permission review left the product surface; /connect keeps working as a
// waypoint so old links land in the workspace.
export default function ConnectPage() {
  redirect("/workspace");
}
