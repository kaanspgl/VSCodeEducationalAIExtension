import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  // The same page, opening straight on the consent form: the address to give participants.
  route("study", "routes/home.tsx", { id: "routes/study" }),
  route("api/events", "routes/api.events.ts"),
  route("api/command", "routes/api.command.ts"),
  route("api/settings", "routes/api.settings.ts"),
  route("admin", "routes/admin.tsx"),
  route("admin/export.csv", "routes/admin.export.ts"),
  route("admin/requests.csv", "routes/admin.requests.ts"),
  route("admin/requests-key.csv", "routes/admin.requests.ts", { id: "routes/admin.requests-key" }),
  route("admin/data.zip", "routes/admin.data.ts", { id: "routes/admin.data-all" }),
  route("admin/data/:code", "routes/admin.data.ts"),
  route("admin/log/:code", "routes/admin.log.ts"),
  route("admin/chat/:code", "routes/admin.chat.tsx"),
  route("favicon.ico", "routes/favicon.ts"),
] satisfies RouteConfig;
