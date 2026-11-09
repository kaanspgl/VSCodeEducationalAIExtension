import { redirect } from "react-router";
import { studentLogout } from "~/.server/access";
import type { Route } from "./+types/logout";

/** Signs the participant out of this browser (their files and log stay). */
export async function action({}: Route.ActionArgs) {
  throw redirect("/consent", { headers: { "Set-Cookie": studentLogout() } });
}

export async function loader() {
  throw redirect("/");
}
