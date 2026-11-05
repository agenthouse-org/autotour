# Live in-app tours

AutoTour has two complementary capabilities. Use `autotour` to capture screenshots, replays and video from an automated journey. Use `@agenthouse-org/autotour-runtime` to guide a person through their own live application. Their journey formats differ; capture definitions are not automatically converted to live tours.

## Install and serve

After the runtime has been published, install `npm install @agenthouse-org/autotour-runtime`. Bundlers can import `@agenthouse-org/autotour-runtime`. For applications serving native browser modules, copy the package's entire `src` directory to a public directory, and load its `index.js` as a module. Keep relative paths intact and serve the assets with JavaScript MIME types. See the runtime package README and demo for a complete example.

```html
<script type="module" src="/vendor/autotour-runtime/src/index.js"></script>
<ah-webtour id="tours" product-id="my-app" locale="en" catalog-url="/tours/manifest.json">
  <ah-webtour-help slot="help"></ah-webtour-help>
</ah-webtour>
```

Register a tour in JavaScript or provide a catalog and localized JSON tours. The runtime retains `ah-webtour` elements, events, CSS custom properties, parts and `ah-webtour:<productId>` preference keys. Existing manifests and preferences need no conversion. Use the provided schema files to validate tour content. Review the application journey and browser behavior with representative users.

## Migration from webtour

| Existing | Replacement |
| --- | --- |
| `@agenthouse-org/webtour` | `@agenthouse-org/autotour-runtime` |
| `@agenthouse-org/webtour/mcp` | `@agenthouse-org/autotour-runtime/mcp` |
| `@agenthouse-org/webtour/theme/default.css` | `@agenthouse-org/autotour-runtime/theme/default.css` |
| `@agenthouse-org/webtour/schema/...` | `@agenthouse-org/autotour-runtime/schema/...` |
| `/vendor/agenthouse-webtour/src/index.js` | Serve runtime `src/` and update the URL, or keep the old URL during cutover |
| `ah-webtour-mcp` and `webtour.*` tools | Unchanged; run the executable from the runtime package |

A transitional `@agenthouse-org/webtour` bridge forwards documented package exports once released. It does not preserve arbitrary deep imports or static files served from a former package directory. Its retirement date is not yet set. Keep the previous version and deployed assets available for rollback. Verify catalog loading, localization, completion events and existing preferences in the target application.

For agent use, run `AH_WEBTOUR_DIR=./tours npx ah-webtour-mcp` (or set the variable using your platform's syntax). The MCP server offers `webtour.list_tours`, `create_tour`, `add_step`, `update_step`, `set_locale`, `validate`, and `publish`. Publish writes the local catalog; it does not deploy your website.
