import { redirect } from "react-router";

/** Browsers ask for /favicon.ico even with an icon link; without this every first visit logs a "no route" error. */
export function loader() {
  return redirect("/favicon.svg", 301);
}
