# MATU ART — Contexto persistente del proyecto

Actualizado: **23 de octubre de 2026**, America/Santiago.
Etapa 8.2 en curso; frontend GitHub Pages preparado localmente. DB v10 intacta.
Sin cloud desplegada ni sincronización habilitada. Ver actualización 8.2 al final
y docs/cloud-8.2.md; las secciones anteriores conservan contexto histórico.

## 1. Cómo utilizar este documento después de compactar

1. Leer este documento y la petición más reciente del usuario.
2. Verificar los archivos relevantes antes de cambiar su comportamiento. Este resumen
   describe el estado actual; no sustituye el código ni autoriza tareas adicionales.
3. Consultar [README](../README.md) para el historial detallado y
   [backup-format.md](backup-format.md) para el contrato de respaldo/restauración.
4. Mantener actualizados este documento, README y el manifiesto artístico al completar
   una etapa. No borrar documentación histórica ni confundir restricciones antiguas
   de una etapa con el alcance actual: por ejemplo, hoy sí existen ventas reales,
   promociones, combos, gastos, exportaciones y Service Worker.

**Implementado** significa que existe código; **verificado** indica una prueba
realmente ejecutada; **planificado** no significa implementado. Las limitaciones de
verificación están en la sección 9. La Etapa 8.1 tiene implementación local; no está desplegada ni sincroniza datos.

## 2. Producto, identidad y alcance actual

- Aplicación personal de POS, inventario y administración para un emprendimiento
  artístico que vende en ferias. Prioridad: Android/móvil, operación rápida y local.
- Marca visible oficial: **MATU ART**. Antes se llamó Clown UFO. `cherry`, Cherry
  Circus y Circus Atelier son referencias internas/históricas; no introducirlas
  nuevamente como marcas visibles ni renombrar claves persistidas por estética.
- Conservar crema, rosa cereza pastel, tipografía editorial, carpa, ornamentos,
  boletos y navegación responsive. No rediseñar POS ni reemplazarlo por un dashboard
  corporativo. Lenguaje operativo breve, sin eslóganes innecesarios.
- Inicio prioriza **Ir al punto de venta**, con evento activo secundario e indicadores
  reales. Estadísticas es una ruta secundaria accesible desde Inicio.
- Base real local; no insertar productos/ventas ficticios automáticamente. Siguen
  existiendo tipos y recursos demo en el repositorio, pero no son la fuente operativa.

### Estado por etapas

| Etapa | Estado real implementado |
| --- | --- |
| 2 y 2.5 | Productos/categorías persistentes, movimientos auditados, costo promedio/último/estimado, historial y reglas de insuficiencia de stock. |
| 3 y 3.5 | Ventas y pagos reales, idempotencia, costos automáticos, anulación atómica, archivados/reactivación; pago mediante tres campos simultáneos. |
| 4 y 4.5 | Categoría principal separada de Familias e IPs, migraciones históricas, organización y creación rápida; filtros combinables. |
| 5.1–5.3 | Descuentos manuales, promociones automáticas, combos y compatibilidad con packs físicos independientes. |
| 6.1–6.3 | Eventos reales, precios por evento, ofertas por cantidad/eventos, producto simplificado, selectores flotantes y administración directa de promociones. |
| 7.1 y ajustes | Dashboard por eventos/días/productos/general, manifiesto artístico, marca MATU ART, reversión compensatoria de movimientos manuales. |
| 7.2 | Gastos globales/de evento con auditoría y rentabilidad bruta/neta estimada. |
| 7.3 | CSV/Excel, PDF financiero, respaldo JSON/restauración, caché offline y correcciones de tickets, payaso y carrito. Restauración UI pendiente de prueba manual. |
| 8.1 | Worker/D1 con autenticación, gateway Apps Script de lectura firmado y panel React implementados. Pruebas locales aprobadas; despliegue y Google Sheets real pendientes. Sin sincronización. |

## 3. Arquitectura y mapa del código

Proyecto existente: `C:/Users/4riel/Desktop/appventas/my-project`.
React 19, TypeScript 6 estricto, Vite 8; Tailwind 4 está instalado y la identidad se
resuelve principalmente mediante CSS propio. Componentes funcionales, sin router
externo ni biblioteca pesada de gráficos. Versiones exactas en `package-lock.json`.

| Ubicación | Responsabilidad |
| --- | --- |
| `src/main.tsx`, `src/App.tsx` | Arranque, CatalogProvider, navegación, carrito temporal, estilos y registro de caché de producción. |
| `src/navigation/` | Navegación por hash; rutas inicio, venta, inventario, historial, promociones, eventos y estadísticas; protección de navegación con borradores. |
| `src/screens/` | Home, PointOfSale, Inventory, History, Promotions, Events, Analytics. |
| `src/components/` | Modal, Checkout, SaleDetail, listas, TicketFrame y componentes reutilizables. Subdirectorios catalog, analytics, data, etc. |
| `src/hooks/` | CatalogProvider/context, useCart, useStorageAction, useAnalytics. |
| `src/types/catalog.ts`, `sales.ts`, `promotions.ts`, `events.ts`, `expenses.ts`, `discounts.ts` | Modelos persistentes/comerciales. `types/index.ts` también conserva tipos demo antiguos: no usarlos como modelo real. |
| `src/services/catalogDatabase.ts` | Apertura idb, esquema v9 y migraciones acumulativas. |
| `src/services/*Repository.ts` | Validaciones y transacciones de catálogo, clasificaciones, ventas, promociones, eventos y gastos. |
| `src/services/*Rules.ts`, `catalogValidation.ts`, `productPricing.ts`, `promotionConditions.ts`, `movementReversal.ts` | Funciones puras y reglas de negocio, separadas de UI. |
| `src/services/analytics.ts`, `expenseRules.ts` | Agregaciones históricas y cálculos financieros compartidos con exportaciones/PDF. |
| `src/services/data/` | Snapshot completo, esquema Zod, respaldo/restauración, tablas de exportación, CSV/XLSX/PDF, descargas y Workers locales. |
| `src/assets/`, `src/styles/`, `src/App.css` | Recursos centralizados, manifiesto de procedencia, tema y estilos. `tickets.css` se carga después de App.css. |
| `offlinePlugin.ts`, `src/services/offlineStatus.ts`, `vite.config.ts` | Precaché de producción y estado offline. |
| `tests/`, `artifacts/` | Pruebas Node/fake-indexeddb y evidencia guardada de verificaciones. |

CatalogProvider recarga snapshots mediante repositorios y comparte estado con React.
Se refresca al recuperar foco y por BroadcastChannel `clown-ufo-catalog`; esto es
coordinación entre pestañas locales, **no sincronización remota**. useAnalytics memoiza
la agregación sobre los snapshots; no consulta toda la DB en cada render.
El carrito se mantiene en memoria mediante useCart, no es una venta persistida.

Dependencias de datos: `idb`; exportaciones: `exceljs`, `fflate`, `jspdf`,
`jspdf-autotable`, `zod`. Existe override de `uuid` para ExcelJS. Los Web Workers
de archivos son hilos locales del navegador: **no son Cloudflare Workers**.

## 4. Persistencia y migraciones

**Nombre de DB: `clown-ufo-catalog`. Versión: 9.** No cambiar el nombre por MATU ART.
IndexedDB es la fuente operativa, sin localStorage como base de ventas.
UUID estables generados con `crypto.randomUUID()`; asociaciones por ID, no por nombre.
Datos separados por origen/perfil/navegador: `localhost`, `127.0.0.1`, 5173 y 5174
no se deben tratar como la misma base. No mover ni borrar bases del usuario para QA.

| Versión | Migración existente |
| --- | --- |
| 1 | products, categories, movements. |
| 2 | costChanges; no inferir estimados a partir de costos históricos. |
| 3 | sales, payments, metadata, events legacy. |
| 4 | families/ips; copia de categorías a familias con el mismo UUID, conservando categorías originales y asociaciones. |
| 5 | Recupera categoría principal verificable por UUID; ambigüedad/sin evidencia queda classificationPending. No asigna por coincidencia de nombre. |
| 6 | promotions. |
| 7 | Marcador `combos-packs-v1` en metadata, sin recrear productos. |
| 8 | managedEvents: eventos reales independientes de events legacy. |
| 9 | expenses, expenseCategories, expenseChanges; categorías de gastos iniciales, sin gastos ficticios. |

Los **15 almacenes** actuales son products, categories, families, ips, movements,
costChanges, sales, payments, metadata, events, managedEvents, promotions, expenses,
expenseCategories y expenseChanges. `events` legacy no se elimina ni se convierte
automáticamente en eventos gestionables. v9 incluye índice único del evento activo.
No hubo migración estructural local en 7.3 ni 8.1. Cuentas/sesiones están en D1
independiente (migración SQL 0001); no hay outbox ni cola de sincronización.

Revisión optimista mediante revision/updatedAt según entidad. Las escrituras
relacionadas se agrupan en una transacción; esperar `tx.done` antes del éxito.
Conservar índices únicos, auditorías, reintentos y tratamiento de errores de cuota,
acceso, bloqueo de actualización de DB y versiones incompatibles.

## 5. Reglas comerciales que no deben perderse

### Productos, clasificaciones e inventario

- Nombre obligatorio y único entre productos activos. Normalización NFKC, trim,
  espacios internos colapsados y minúsculas es-CL. Archivado no elimina el UUID ni
  las relaciones; reactivar puede fallar si hay un nombre activo duplicado.
- Categoría principal única obligatoria al crear/guardar el formulario. Productos
  legacy sin categoría verificable se conservan pendientes, sin inventarles una.
  Familias e IPs son listas opcionales independientes. Los nombres son únicos dentro
  de cada tipo. Archivar una clasificación conserva asociaciones antiguas e impide
  nuevas asignaciones mientras siga archivada.
- Filtros: OR dentro de familias/IPs seleccionadas, AND entre grupos de clasificación
  y búsqueda. Cambiar filtros no vacía el carrito. POS excluye productos archivados,
  pero muestra agotados y advertencias de insuficiencia.
- CLP entero no negativo en precio/costos; `undefined` significa desconocido,
  **no cero**. Los validadores de catálogo limitan magnitudes a 1.000.000.000.
  Imágenes de producto Blob PNG/JPEG/WebP hasta 5 MB en formulario.
- Stock inicial, reposición, ajuste y conteo generan movimientos con antes/después.
  El formulario general de edición no cambia directamente existencias. Stock manual
  puede ser negativo y se advierte; no borrar movimientos históricos.
- Reversión directa solo de reposición/ajuste/conteo elegibles, no inicial, venta ni
  anulación. Genera `manual_reversal` enlazado al original, contra stock **actual**.
  Evita doble reversión y exige motivo. Restaura costos anteriores solo si revisión,
  saldo y costos coinciden con el estado posterior original; si no, conserva costos
  actuales y marca promedio provisional. No reescribe historia.
- Packs físicos son productos con precio/costo/stock propios. Se crean por el flujo
  normal sin selector de tipo. Packs legacy y packContents siguen compatibles; vender
  un pack descuenta su stock, no automáticamente el de sus componentes. No asumir que
  existe un flujo de fabricación/despiece.

### Costos

- El único costo de creación alimenta initialCost y estimatedUnitCost; el repositorio
  inicializa promedio y último costo. Puede omitirse. Edición posterior cambia el
  estimado con auditoría anterior/nuevo/fecha/motivo, sin tocar promedio ni último.
- Reposición con costo conocido y stock positivo: promedio ponderado entero.
  Stock cero/negativo, promedio ausente o reposición de costo desconocido tienen
  tratamiento provisional explícito en `restockCost`; no sobrescribir estimado.
- Al confirmar venta, prioridad: promedio válido → estimado → último conocido →
  desconocido. Promedio provisional conserva su condición y sigue teniendo prioridad.
  Copia histórica de unitCost, source, isProvisional y condition; no selector de
  costos en el cobro. Las ventas antiguas no se recalculan.

### Venta, stock y pagos

- `calculateSaleStock`: descontado = min(max(stock anterior, 0), cantidad vendida);
  stock posterior = anterior − descontado; diferencia = vendida − descontado.
  Se venden 8 con stock 7: vendidas 8, descontadas 7, saldo 0, diferencia 1.
  Stock inicialmente negativo queda igual, no empeora mediante venta normal.
- Checkout revalida productos, revisiones, evento, precio efectivo, costos,
  promociones y pagos dentro de la transacción. Cambios durante pago requieren
  revisión. No confiar solo en el snapshot visual del carrito.
- operationId + fingerprint e índice único impiden ventas duplicadas; igual reintento
  retorna la venta existente, mismo ID con otro contenido falla. El número de venta
  es un contador local, **no una secuencia global preparada para múltiples equipos**.
- Guardado atómico de venta, pagos, movimientos, stock y contador. Snapshots contienen
  nombres, cantidades, precios, costos, descuentos, promociones/combos y evento.
- Siempre Efectivo/Transferencia/Débito; por defecto efectivo = total. Vacío = cero;
  rechazar negativos, decimales e inválidos; suma exacta al total. UI envía solo pagos
  mayores a cero. Venta de total cero es válida con lista de pagos vacía.
- Anular exige motivo, confirmación y decisión sobre stock. Conserva venta, pagos,
  descuentos y auditoría. Devuelve solo lo efectivamente descontado mediante
  `sale_void`, nunca la diferencia no cubierta. Reintento idéntico es idempotente;
  otra anulación de una venta anulada falla. No implica reembolso monetario real.

### Descuentos, promociones, combos y precios por evento

- Manual por línea sobre el importe de esa línea, no sobre catálogo. Porcentaje
  0–100 con hasta dos decimales o CLP fijo entero. Fijo mayor al saldo se rechaza.
- Orden: **precio efectivo → manual individual → motor conjunto de promociones/
  combos/grupos → manual general**. Nunca total negativo. Redondeo por descuento
  al peso más cercano, mitades arriba, usando BigInt/puntos básicos; repartos por
  restos mayores con desempate estable por UUID.
- Destinatarios: OR dentro de productos/categorías/familias/IPs, AND entre grupos;
  grupo vacío es comodín. Mínimos sobre unidades/importes elegibles originales,
  antes de descuentos. Fechas inclusivas de Chile; reloj local del dispositivo.
- Promociones que se solapan necesitan compatibilidad/acumulación; las disjuntas
  pueden coexistir. El motor busca el menor total válido con desempate estable por
  menor número de beneficios y claves de reglas/unidades. No sustituir por una
  heurística que silenciosamente dé menos beneficio. Manual general fijo se conserva;
  una combinación automática que lo vuelva inválido se descarta, no lo recorta.
- Combos: hasta 4 componentes producto/categoría y 8 unidades por aplicación.
  Regla quantity: grupos de 2–8 unidades a precio final; cinco unidades con 2 por
  $1.000 forman dos grupos y una suelta a su precio. No reutilizar unidades entre
  grupos/combos incompatibles. Se guardan copias en appliedCombos.
- Límites explícitos: 12 reglas activas, 24 unidades elegibles para grupos/combos,
  128 asignaciones por regla/estado y 20.000 pasos. Excederlos muestra error y bloquea
  cobro; no calcula una aproximación. Ver motores para condiciones exactas.
- Evento activo único, leído transaccionalmente; sin evento se puede vender.
  Eventos upcoming/active/finished; un finalizado no se reactiva en el repositorio.
- eventPrices pertenece al producto: una excepción por UUID de evento, CLP entero
  no negativo, incluido $0. Excepción del activo o precio general como fallback.
  Cambiar evento recalcula carrito sin perder productos/cantidades/manuales; pago
  abierto se invalida con event-price-revision y contexto de revisión.
- Excepciones se administran **al editar producto**, no al crear ni al cobrar.
  Una unidad con excepción vigente queda excluida de promociones restringidas por
  evento para evitar doble beneficio. Manuales y promociones generales siguen
  compatibles sobre precio efectivo. Conversión de excepciones a promociones sigue
  siendo propuesta, no implementada; no borrar excepciones heredadas.

### Gastos, estadísticas e informes

- Gastos globales o por evento, categoría, fecha local, concepto, importe y notas;
  crear/editar/anular con auditoría before/after y revision. No son movimientos de
  inventario ni ventas. Categorías de gasto: selección y creación; falta administrador
  completo para renombrar/archivar.
- Ingresos = suma de total final de ventas completed; transacciones = número de ellas;
  unidades = cantidades vendidas, incluso diferencia no cubierta; ticket promedio =
  ingresos/transacciones con redondeo CLP. No sumar pagos otra vez a ingresos.
- Costo vendido = copias de costo × cantidades; utilidad bruta = ingresos − costos;
  neta = bruta − gastos activos del contexto. Margen requiere ingresos positivos y
  utilidad disponible. No distribuir gastos globales entre eventos.
- Costos desconocidos hacen utilidades/margen no disponibles; costo parcial sigue
  identificado. Estimados/provisionales permiten estimación señalada como tal.
  Anuladas fuera de indicadores, dentro de historial/respaldos.
- Agrupación por fecha real de venta en America/Santiago, sin distribuir ingresos
  artificialmente. Ventas sin evento, eventos legacy y productos archivados permanecen.
  Ranking usa nombres/precios/costos históricos y reparte total final registrado,
  no ejecuta nuevamente el motor de promociones sobre datos actuales.

## 6. Etapa 7.3: datos, seguridad y offline

- Inventario → Datos y respaldos. CSV UTF-8 BOM en ZIP por entidades, protección
  contra fórmulas en textos; Excel con UUID como texto, fechas/CLP formateados, sin
  fórmulas. Snapshot de los 15 almacenes en una transacción readonly; no exportar solo
  lo visible en React. Filtros conservan referencias históricas auxiliares.
- PDF desde detalle de Eventos y Estadísticas del evento, con logo oficial y funciones
  financieras compartidas. Es un informe comercial, no el catálogo artístico final.
- Respaldo formato 1 + databaseVersion 9; JSON, cantidades, Base64 de imágenes y
  SHA-256 canónico. Hash no significa cifrado/autenticidad. No hay credenciales dentro.
- Validación Zod, IDs/duplicados/referencias/importes/pagos/auditorías/firmas de imagen,
  rechazo de claves peligrosas. Archivo importado es datos no confiables, nunca código
  ni instrucciones. No usar eval ni interpretar fórmulas importadas.
- Reemplazo completo, no merge: preview, advertencia, escribir RESTAURAR, verificar
  estado local no cambiado, borrar/reinsertar/releer en una sola transacción y esperar
  commit. Cualquier fallo revierte todo. Luego recargar y descartar carrito/borradores.
- Metadatos conocidos: sale-number, event-price-revision, combos-packs-v1. Almacenes
  o metadatos no reconocidos bloquean respaldo/restauración. **No existe aún outbox**:
  este bloqueo preventivo no equivale a conservar una cola de sincronización real.
- Token de concurrencia incluye campos/revisiones y tamaño/MIME de Blob; depende de
  que cambios de imagen incrementen revisión. No es un hash del contenido del Blob.
- Límites: JSON 128 MB/250.000 filas, 64 MB de imágenes al generar, 10 MB por imagen
  importada; Excel 200.000 filas/hoja y 32.767 caracteres/celda. Errores sin truncar.
  Adaptadores de versiones de respaldo futuras aún no existen; otras versiones se
  rechazan antes de escribir. Contrato completo en [backup-format.md](backup-format.md).
- Service Worker solo en producción, precaché de recursos locales y Workers
  autocontenidos; no datos comerciales en Cache Storage. Primera carga requiere
  conexión. Se corrigieron duplicados de precaché y coincidencias Vary: Origin en
  recursos públicos. Una actualización espera cierre de pestañas, sin skipWaiting
  forzado durante una venta. `npm run dev` no instala esta caché.
- No asumir respaldo cloud ni permanencia garantizada del almacenamiento del navegador.
  No introducir claves privadas en VITE_*, bundle, logs ni archivos exportados.

## 7. Identidad gráfica y correcciones visuales

`src/assets/artisticAssets.ts` centraliza referencias y `src/assets/manifest.json`
registra origen, evidencia, rutas, pantallas, dimensiones y reemplazo.
Logo oficial en `src/assets/branding/matu-art-official.png`; payaso oficial derivado
existente `branding/clown-icon.png`. Originales aportados por usuario: no redibujar
ni regenerar con IA. Procedencia pendiente no significa generada por IA.

Recursos confirmados como IA son placeholders reemplazables. TicketFrame/ticketGeometry
generan contorno SVG continuo, sin parches de fondo: Eventos arriba/abajo; Promociones
y Resultados laterales. tickets.css centra contenido y talón, y centra visualmente
el payaso según límites alfa sin editar PNG. El carrito usa un único borde, sin el
pseudoelemento inferior que sobresalía. Conservar la decoración superior.

**Pendiente hasta terminar Google Sheets:** PDF visual + Excel inventario completo
de recursos para artistas, incluidas incorporaciones futuras. No generarlos ahora.

## 8. Etapa 8.1 — Implementada localmente, despliegue pendiente

Guía operativa: [cloud-8.1.md](cloud-8.1.md). Esquema futuro Sheets:
[sheets-schema.md](sheets-schema.md). Esta sección sustituye la planificación anterior.

- Arquitectura acordada y preparada: React → Worker Cloudflare → Apps Script →
  Sheets. IndexedDB sigue operativa y no se modifica al iniciar/cerrar sesión.
- `backend/` es paquete independiente (Wrangler 4, nodejs_compat). `src/index.ts`:
  status, login, session, logout, connection/test; `security.ts`: scrypt, cookies
  opacas y firmas; `gateway.ts`: protocolo HMAC y respuesta limitada/verificada.
- D1: users, sessions, attempts; migración SQL 0001. No Google Login ni registro
  público. Bootstrap CLI interactivo, contraseña oculta, primer admin solamente.
- scrypt-v1 N=16384/r=8/p=5, sal individual 16 bytes. Contraseña nunca en claro en
  D1. Sesión aleatoria 32 bytes; DB conserva hash SHA-256; 8 h absolutas. Cookie
  __Host-matu-session HttpOnly/Secure/SameSite=Strict. CSRF por Origin + JSON +
  token de sesión en mutaciones autenticadas. No tokens en almacenamiento frontend.
- Roles administrator/manager/seller desde D1. Solo admin/manager prueban gateway;
  vendedor puede consultar/cerrar su sesión. No permisos comerciales remotos aún.
- Límites UPSERT D1: 5 login/usuario/15min, 30/IP/15min, 120 global/min; prueba
  Sheets 5/min/usuario. Limpieza cron. No réplicas D1 habilitadas: adaptar sesiones
  consistentes antes de activarlas. Error sin detalles internos y no-store.
- Producción: mismo origen HTTPS frontend/API (/api). Desarrollo: localhost con
  puerto configurable y CORS de un único origen exacto. API fuera de caché SW.
- Apps Script `Code.gs`: firma HMAC-SHA256 del keyId + salto de línea + payload
  exacto en cuerpo, no encabezados inaccesibles desde doPost. Timestamp ±60s,
  nonce persistente 125s bajo lock, máximo 200 vivos. Rechaza anónimos/replays;
  solo ping/metadatos, alcance spreadsheets.readonly. No escrituras comerciales.
- Rotación por keyId y claves de servidor; GAS_SECRET solo Worker, GATEWAY_KEYS
  y SPREADSHEET_ID solo ScriptProperties. No secretos reales configurados aún.
  ContentService redirige salida; Worker solo acepta destino googleusercontent
  esperado mediante GET sin cuerpo firmado. Respuesta versionada y requestId.
- UI: Inventario → Conexión a la nube. Cliente tipado con validación Zod, sesión
  y CSRF solo en memoria. Offline/errores no bloquean POS. Panel carga diferida,
  sin cambios de estética, logo ni recursos gráficos.
- `FutureSyncOperation` define UUID de operación/dispositivo/workspace, revisiones,
  entidad, estado pending/confirmed/conflict y ACK; **solo contrato**. Sin outbox,
  migración, generación de deviceId, envío automático ni marcas de sincronizado.
- Un despliegue por emprendimiento. La sesión no aísla el IndexedDB compartido en
  el dispositivo ni autentica accesos locales. No cuentas multiempresa todavía.

Verificado: 240 pruebas (230 previas + 10 cloud), build/lint, TS backend y Wrangler
bundle dry-run. Workerd+D1 local: login con scrypt, parada/reinicio real del proceso,
sesión persistente y logout revocado. Navegador localhost:5176 aislado: login/cookie/
sesión/logout y error de gateway no configurado; backend detenido muestra error de
red sin bloquear Inventario. Panel revisado en 390×844, 425×876 y escritorio.
Prueba automática adicional confirma venta offline con fetch bloqueado y reapertura
de IndexedDB; login/logout no modifican snapshot local. Apps Script se ejecuta en
VM con servicios Google simulados: **no constituye prueba contra Google real**.

Pendiente externo: cuenta/dominio Cloudflare, D1 remoto, ruta /api, secretos, Apps
Script desplegado/autorizado, hoja privada con cabeceras, admin real y prueba E2E.
Workers Free (10 ms CPU) no es un objetivo viable para este hashing: dimensionar
plan CPU adecuado y medir en producción, sin debilitar scrypt. No cuotas ilimitadas.
No MFA, recuperación de contraseña, UI de cuentas ni sync implementados.

Para 8.2: resolver workspace/dispositivo, roles comerciales, outbox atómica junto
con repositorios locales, ACK/idempotencia durable, conflictos/versiones, journal
Sheets sin transacciones multitabla, imágenes, contadores locales entre dispositivos,
y restauración con pendientes. No iniciar esa etapa sin nueva solicitud.

## 9. Verificación real y problemas conocidos

Última ejecución registrada de 7.3: **build correcto, lint correcto, 230 pruebas
aprobadas, 0 fallos**, 212 previas + 18 nuevas. Evidencia:
`artifacts/etapa-7-3-tests.txt`. En 8.1 se ejecutó nuevamente la batería: **240 aprobadas, cero fallos**,
build/lint y comprobación TypeScript/bundle del backend correctos. Evidencia nueva:
`artifacts/etapa-8-1-tests.txt`. Las pruebas usan Node `--experimental-strip-types --test` y
fake-indexeddb, no una suite E2E DOM integrada.

Verificado previamente en 7.3:

- Backup/restore aislados, imágenes byte a byte, UUID/relaciones y comparación
  financiera; errores de esquema/hash/referencias; rollback con fallo de cuota
  inyectado después de vaciados; concurrencia y metadatos desconocidos.
- Exportaciones vacías/filtradas, archivados, anuladas, pagos divididos, costos
  incompletos, gastos, manuales/promociones/combos y venta/anulación tras restaurar.
  XLSX y ZIP generados y reabiertos por biblioteca; PDF renderizado en dos páginas.
- UI en 390×844, 425×876 y 1280×900, sin desbordamientos en vistas revisadas.
  Tickets, No disponible, payaso y carrito vacío/con cantidades; generación de
  archivos y descarga de JSON. Pruebas en origen QA 127.0.0.1:5174, separado de 5173.
- Con servidor de QA detenido: recarga y generación de JSON/XLSX/CSV/PDF completadas
  tras corregir la caché. No equivale a prueba de Wi-Fi desactivado en Android real.

Pendiente / limitaciones:

1. **Restauración completa mediante UI no verificada manualmente.** El navegador
   rechazó cargar el JSON por su política de permisos. No eludir esa denegación;
   continuar solo con autorización adecuada y una base aislada. No restaurar sobre
   la base del usuario como prueba. La capa transaccional sí pasó pruebas automáticas.
2. Android físico, teclado virtual real, compartir archivos con otra app, Excel/
   LibreOffice nativos, reinicio completo del navegador y cuota real agotada no
   comprobados. Se recargaron/reabrieron pestañas y conexiones, no todo el proceso.
3. La combinación de reglas tiene límites deliberados. No aumentar capacidad sin
   medir rendimiento y conservar búsqueda exacta; no hay benchmark UI de gran escala.
4. Conversión explícita de precios por evento a promociones aún pendiente; no borrar
   excepciones ni aplicar doble beneficio. Administrador completo de categorías de
   gastos también pendiente, fuera del alcance completado.
5. Respaldos solo aceptan formato/esquema soportado actual; se necesitarán adaptadores
   al cambiar DB. No existen cifrado del respaldo, backup cloud ni importación masiva.
6. Autenticación/API existen como código probado localmente, sin despliegue remoto.
   No existen sincronización, cola durable, manejo de
   conflictos entre dispositivos ni cierre de caja/contabilidad fiscal/reembolsos
   bancarios. Una anulación local no acredita devolución de dinero.
7. Provider/estadísticas usan snapshots completos en memoria, memoizados; exportación
   y respaldo también tienen límites de memoria/tamaño. No afirmar escala ilimitada.

## 10. Pasos de continuidad

- Priorizar el siguiente alcance que indique el usuario; no avanzar automáticamente
  a toda la Etapa 8 al leer este documento.
- Antes de tocar sincronización, completar despliegue/verificación externa de 8.1 y contratos de
  seguridad; diseñar migración no destructiva y compatibilidad de respaldos.
- Conservar las 240 pruebas y añadir casos de offline, idempotencia remota, aislamiento
  de cuenta, sesiones y restauración con pendientes cuando esas funciones existan.
- Para cambios funcionales ejecutar `npm run build`, `npm run lint`, `npm test`.
  `npm run dev` sirve desarrollo; para validar caché usar build + preview en origen
  aislado y primera carga completa. No confundir datos entre puertos.
- Documentar siempre qué se ejecutó y qué no. Mantener la lista de recursos artísticos
  actualizada; no generar todavía su entrega definitiva ni modificar originales.


## Actualización prioritaria — Etapa 8.1.1 (2026-10-20)

Esta sección actualiza referencias anteriores a DB v9, 240 pruebas y ausencia de
importador. Ver `docs/import-8.1.1.md` para continuidad detallada.

Implementado importador local CSV/TSV separado del POS, vista previa, resolución,
confirmación explícita y transacción atómica. DB v10 agrega solo importRecords con
índice único tipo/hash/fila. Ventas historicalSource; nuevos productos
stockCountPending y primer conteo previousStockUnknown. No movimientos históricos
ficticios, costos desconocidos, anulaciones importadas sin devolución de stock.
Respaldo formato 1, DB10, adaptador de DB9 validando checksum previo.

El usuario entregó catálogo completo 77 productos y confirmó siete correspondencias
ambiguas; pidió dejar pendientes Pack Stickers Sanrio Calavera, Pack Stickers Madoka
y Llavero grumpy cat. Mapeos revisados en services/importing/reviewed.ts solo para el
hash exacto del CSV original. 147 de 150 registros, $184.400 de $192.400 resolubles
contra base vacía; los 3 restantes no se marcan como importados. Fuentes transcritas
en docs/import-sources/, no autoload. Reporte artifacts/etapa-8-1-1-revisado.json.

NO se importó la base del usuario ni se consultó su IndexedDB real. No se debe decir
que los datos ya están cargados. Continuar con vista previa y confirmación en el
origen correcto del usuario; los puertos tienen bases diferentes. La UI permite
aplicar las decisiones revisadas, y posteriormente resolver pendientes manualmente.

Build, lint y 253 pruebas pasan (13 importador). Regresiones completas incluidas.
UI manual pendiente porque CUA no inicializa (kernel assets path missing). No prueba
física offline ni reapertura manual. CSV/TSV hasta5MB/10k filas; sin XLSX/streaming.
No deduplicación semántica entre archivos modificados; stock pendiente bloquea venta
normal hasta conteo físico. Documentar estas decisiones, no presentar cero como stock
confirmado. Nombres activos únicos impiden dos formatos con idéntico nombre sin
revisión. Permiso UI local no equivale a autorización remota.

Cloud 8.1 sigue localmente preparado, sin despliegue real; 8.2 NO iniciada. Drive
futuro MATU ART/BBDD/MATU ART - Base de datos y MATU ART/Respaldos. No prefijos,
carpeta de originales obligatoria ni uploads. Mantener autenticación propia,
Worker/D1 → Apps Script firmado → Sheets; IndexedDB principal offline.

## Actualización prioritaria 8.2 — 21-10-2026

Usuario eligió GitHub Pages gratuito github.io, sin dominio propio, sin Workers Paid.
Creará hoja MATU ART - Base de datos en BBDD y Apps Script vinculado; carpetas
MATU ART/BBDD y Respaldos ya existen según usuario. No importar respaldo de prueba.
No contratar, publicar ni ampliar permisos sin decisión del usuario.

Hallazgo: cookies Strict actuales no funcionan cross-site github.io→workers.dev;
None no evita bloqueo de terceros. Cliente sigue rechazando cross-origin productivo;
no relajar CORS/CSRF ni mover tokens a almacenamiento local. Se consultó al usuario
si preparar Pages sin nube o planificar dominio/proxy; el usuario confirmó
«Preparar Pages; nube pendiente». No reabrir esa decisión para publicar el frontend.

Hecho: base Vite configurable, workflow Pages manual (solo dist, cloud URL vacía),
manifiesto PWA con logo intacto, cache por scope, botón cloud en Datos y respaldos.
Preparación no integrada: catalogContract.ts, backend catalog.ts/catalogGateway.ts,
D1 migration0002. NO nuevas rutas Worker, NO migración D1 aplicada, NO adaptador
GASv2, NO outbox local/preview de sync. No presentar esto como sincronización lista.

Verificado: whoami sin autenticación; 258 pruebas pasan, build raíz/subcarpeta,
lint/check backend. Navegador aislado5191: escritorio/390/425, POS y panel Datos,
recarga de Inventario con servidor detenido desde caché. Sin Android físico ni
Google real. No tocar origen5174 del usuario. No migración IndexedDB (continúa10).

Decisiones nuevas para importación futura: conservar ambos packs como productos;
Llavero grumpy cat como referencia histórica archivada no vendible. Faltan datos
maestros para crear sin inventar; no se modificó el importador ni se cargaron filas.

Continuar con docs/github-pages.md y docs/cloud-8.2.md. Próximo paso manual obtener
repositorio definitivo GitHub (sin publicar secretos/respaldos/artifacts/datos
privados). Carpeta local no es Git. Aún falta decidir arquitectura de sesión y
capacidad Paid, desplegar y verificar servicios, completar motor/control UI de
catálogo. No continuar a8.3, no compartir stock entre dispositivos todavía.

## Continuidad 23-10-2026 — Pages local terminado, publicación pendiente

Decisión vigente: preparar GitHub Pages, nube pendiente. Nada desplegado ni contratado.
Workflow manual usa ahora `npm run build:pages`: valida MATU_BASE_PATH, fuerza API
vacía, compila TypeScript/Vite y comprueba archivos del HTML, manifiesto y precaché.
.gitignore excluye artifacts/, docs/import-sources/ y respaldos/exportaciones raíz;
los originales siguen intactos en disco. No hay repositorio Git local todavía.
Se solicitó URL o CUENTA/NOMBRE del repositorio; pendiente respuesta.

No avanzar con nube, Apps Script escritura, compras, migraciones o datos reales.
El siguiente paso depende únicamente del repositorio y revisión antes de publicación.
No confundir build local con workflow ejecutado o URL github.io verificada.

Verificación del 23-10-2026: build:pages correcto para `/` y `/matu-art/`
(17 recursos por compilación); lint correcto, TypeScript backend correcto y
258 pruebas aprobadas, sin omitidas. URL cloud ficticia de comprobación ausente
del bundle final. Logs locales en artifacts/8-2-*-2026-10-23.log. No se repitió
la comprobación visual del 21-10 ni se ejecutó el workflow remoto.

## Repositorio confirmado — 26-10-2026

Git local inicializado en main; origin apunta a
https://github.com/ElQuesoMagico/MATU-ART-App-Ventas.git (remoto sin referencias
al consultarlo). Ruta Pages verificada: /MATU-ART-App-Ventas/.
Build Pages correcto: 17 recursos, manifiesto y caché; lint correcto;
258 pruebas aprobadas, 0 fallidas y 0 omitidas. Logs locales en artifacts/
con prefijo pages-repository- y fecha 2026-10-26, excluidos de Git.
No se repitieron pruebas visuales ni se ejecutaron Actions remotas.

Preparación local solamente: sin push, despliegue, compras ni conexión cloud.
Antes de publicar revisar documentación histórica con cifras agregadas y
correspondencias de nombres del importador; no contiene los CSV ni respaldos
completos, que siguen excluidos. Se mantiene la decisión Pages primero, nube
pendiente y la revisión del responsable antes de publicar. No cambios a IndexedDB.

## Pages publicado y pantalla en blanco corregida — 26-10-2026

Repositorio subido, commit de aplicación 2d7d0cf. Pages estaba configurado como
legacy desde main / y servía index.html sin compilar, con /src/main.tsx y
%BASE_URL% literales. Se cambió build_type a workflow y se ejecutó pages.yml.
Run 40421105237 finalizó success: instalación, lint, pruebas, build y despliegue.
URL: https://elquesomagico.github.io/MATU-ART-App-Ventas/
Se verificó HTML compilado con recursos bajo /MATU-ART-App-Ventas/, carga de Inicio
y navegación al POS en navegador. No se crearon ventas ni se importaron datos.
La nube sigue deshabilitada. No se verificaron Android físico ni offline remoto.
Publicaciones futuras: ejecutar manualmente Actions > Publicar MATU ART en GitHub
Pages. Mantener Settings > Pages > Source en GitHub Actions, no Deploy from a branch.
