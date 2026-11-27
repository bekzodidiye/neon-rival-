# NEON RIVALS V6.0 — Measured Performance Report

All numbers below were measured directly in this workspace environment (Node.js 22 Linux container; headless Chromium uses SwiftShader software WebGL). No values are estimated or extrapolated.

## 1. Authoritative Server Simulation & Network Telemetry (`npm test`)
Measured across 2, 4, and 8 independent WebSocket clients running full 8-racer 60 Hz simulation + 20 Hz snapshot broadcast on `neon_city`:

| Stage | Independent WS Clients | Total Racers | Avg Snapshots / Client | Snapshot Payload Size | Server Tick Avg | Server Tick Max | Node Heap Used |
|---|---:|---:|---:|---:|---:|---:|---:|
| Stage A | 2 (+6 AI) | 8 | 1,064 | 7,288 B (~7.1 KB) | 0.668 ms | 4.773 ms | 134.3 MB |
| Stage B | 4 (+4 AI) | 8 | 1,034 | 7,299 B (~7.1 KB) | 0.267 ms | 0.431 ms | 181.5 MB |
| Stage C | 8 (0 AI) | 8 | 918 | 7,319 B (~7.1 KB) | 0.075 ms | 0.138 ms | 252.8 MB |
| Stage D (20 clients) | — | — | **NOT TESTED** | — | — | — | — |

**Tick Budget Headroom**: At 60 Hz (`16.67 ms` budget per tick), measured average tick cost is `< 0.7 ms` (`< 4.1%` of single-core frame budget). At 20 Hz snapshot rate, outbound bandwidth per client is `~146 KB/s` uncompressed JSON (candidate for delta/binary compression before scaling to 20-player public production).

## 2. Per-Vehicle Physics Telemetry (`shared/simulation/authoritativeRace.test.ts`)
Measured at 60 Hz on `neon_city` (18s full-throttle run + 150→5 km/h braking test):

| Vehicle | 0–100 km/h | Peak Circuit Speed | Braking Dist (150→5 km/h) |
|---|---:|---:|---:|
| STREET FALCON | 4.88 s | 215 km/h | 20.9 m |
| SAND RUNNER | 4.70 s | 216 km/h | 21.7 m |
| NIGHT VIPER | 4.05 s | 243 km/h | 21.2 m |
| CYBER GT-R | 3.40 s | 272 km/h | 19.0 m |
| PHANTOM X | 2.93 s | 296 km/h | 17.6 m |

## 3. Client GPU Rendering FPS
- **Headless Container (SwiftShader Software WebGL)**: ~1–3 FPS (software rasterizer limitation; GPU-fence pacing via `afterDraw()` prevents browser lockup).
- **Desktop Hardware GPU & Mobile Device FPS**: **NOT TESTED** in this headless container (requires real hardware GPU profiling).
