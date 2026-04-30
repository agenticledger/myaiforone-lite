Compiled server binary goes here. Build with:

  bun build --compile ../src/index.ts --outfile myaiforone-server-aarch64-apple-darwin (for Apple Silicon)
  bun build --compile ../src/index.ts --outfile myaiforone-server-x86_64-apple-darwin (for Intel Mac)
  bun build --compile ../src/index.ts --outfile myaiforone-server-x86_64-pc-windows-msvc.exe (for Windows)

Tauri expects the binary to be named with the platform triple suffix as above.
The CI workflow (`.github/workflows/build.yml`) builds these automatically.
