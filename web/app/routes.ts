import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/events", "routes/api.events.ts"),
  route("api/command", "routes/api.command.ts"),
  route("favicon.ico", "routes/favicon.ts"),
] satisfies RouteConfig;
