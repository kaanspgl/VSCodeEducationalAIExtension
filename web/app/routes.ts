import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("consent", "routes/consent.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.ts"),
  route("admin", "routes/admin.tsx"),
  route("admin/login", "routes/admin.login.tsx"),
  route("admin/p/:code", "routes/admin.participant.tsx"),
  route("admin/download/:file", "routes/admin.download.ts"),
  route("api/events", "routes/api.events.ts"),
  route("api/command", "routes/api.command.ts"),
  route("favicon.ico", "routes/favicon.ts"),
] satisfies RouteConfig;
