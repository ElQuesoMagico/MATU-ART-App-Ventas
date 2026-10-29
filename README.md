# MATU ART

Punto de venta e inventario local para un emprendimiento artístico. React 19,
TypeScript estricto, Vite 8 e IndexedDB mediante `idb`. Se conserva la interfaz
circense, sus ilustraciones, tickets, navegación y tema interno Cherry Circus.

La Etapa 7.2 incorpora gastos auditables y rentabilidad por evento sobre las
ventas históricas. IndexedDB utiliza la versión 9: la migración desde v8 añade
únicamente almacenes de gastos, auditoría y categorías. Se mantienen POS,
inventario, promociones y eventos; no hay conexión con Google Sheets.
Los informes de cada etapa y sus verificaciones están al final del documento.

**Estado actual: Etapa 8.2 en curso, sin despliegue cloud.** IndexedDB v10 e
importador 8.1.1 disponibles. Frontend preparado para GitHub Pages; la conexión
entre github.io y workers.dev no se habilita con cookies de terceros. Falta decidir
dominio/proxy y Workers Paid, además del despliegue y sincronización completa.
Ver [estado 8.2](docs/cloud-8.2.md), [GitHub Pages](docs/github-pages.md) y
[PROJECT_CONTEXT](docs/PROJECT_CONTEXT.md). Se conservan los informes históricos.

## Desarrollo

- `npm install`
- `npm run dev`
- `npm run build`: TypeScript y producción.
- `npm run lint`: Oxlint.
- `npm test`: pruebas con Node 24 y `fake-indexeddb` (solo desarrollo).
- `npm run preview`: revisar `dist/`.

## Venta real

El flujo es catálogo → carrito → continuar al pago → ingresar importes → confirmar.
Volver conserva cantidades y los importes del pago dividido,
también al navegar entre secciones. Solo la confirmación guarda la venta.
El carrito se limpia después de terminar la transacción; ante errores permanece
disponible. El carrito sigue siendo temporal y se pierde al recargar la página.

Se registran Efectivo, Transferencia y Débito; el pago dividido admite varias
formas cuya suma debe coincidir exactamente con el total. Los importes son
enteros CLP no negativos. No hay cálculo de vuelto ni cobro a través de bancos
o terminales: se registra la forma de pago indicada por el usuario.

Cada venta guarda UUID, ID de operación, número consecutivo `V-000001`, fecha,
estado, artículos históricos, subtotal, descuentos, total, pagos, evento
real opcional, diferencias de stock e IDs de movimientos. Los artículos copian
nombre, descripción, categorías, cantidades, precio y costo utilizado. Cambios
posteriores en el catálogo no alteran esas copias, incluso al archivar productos.

El costo se resuelve automáticamente al confirmar, dentro de la transacción:
promedio válido (conservando su condición provisional), estimado actual,
último conocido y finalmente desconocido. No hay selectores de costo en el pago.
La copia guarda importe, fuente, indicador provisional y condición
(known, estimated, provisional, unknown). Las ventas anteriores conservan
sus copias originales y no se reescriben.
Costo desconocido nunca se convierte en cero. Cero conocido se conserva como tal.
Las ventas no modifican el costo estimado, el último conocido ni el promedio;
si se agota stock o se devuelven unidades, el promedio puede quedar provisional.

Los productos se vuelven a leer dentro de la transacción. Si la revisión, precio
o costo cambió durante el pago, se pide volver al carrito y revisar. Se admite
stock insuficiente con advertencia, conservando todas las unidades vendidas:

| Stock previo | Vendidas | Descontadas | Stock final | Diferencia |
| ---: | ---: | ---: | ---: | ---: |
| 7 | 8 | 7 | 0 | 1 |
| 7 | 3 | 3 | 4 | 0 |
| 0 | 5 | 0 | 0 | 5 |
| -2 | 5 | 0 | -2 | 5 |

Un stock ya negativo se conserva, sin reducirlo más ni corregirlo silenciosamente.
Se crea un movimiento de venta incluso con descuento cero, con venta asociada,
cantidad vendida y diferencia no cubierta. No se inventan ventas desde movimientos.

## Atomicidad y anulaciones

`SalesRepository` confirma en una transacción de `products`, `sales`, `payments`,
`movements`, `metadata`, `events` (legacy), `managedEvents` y `promotions`. Venta, pagos, cambios de stock, movimientos y
contador se confirman juntos. Se espera `tx.done` antes de mostrar éxito. Una
escritura fallida revierte todo, incluido el contador.

El ID de operación permanece estable durante el carrito y los reintentos. Un
índice único evita duplicados; el mismo ID y contenido devuelve la venta original,
y reutilizarlo con contenido diferente se rechaza. Un bloqueo síncrono evita
dobles clics en la interfaz. El número visible no se reutiliza al anular.

Anular exige motivo y elección de devolver stock. La venta nunca se elimina:
conserva artículos, precios, costos y pagos originales, y añade auditoría de
anulación con fecha, motivo, ID y movimientos compensatorios. Si se devuelve
stock se reponen solo las unidades efectivamente descontadas: una venta de 8
con stock 7 devuelve 7, no 8. También funciona para productos archivados sin
restaurarlos. Sin devolución no cambia existencias. La anulación es atómica e
idempotente; no puede devolver stock dos veces. No procesa reembolsos financieros.

Historial muestra exclusivamente ventas locales, con filtros por fechas de
Santiago, evento y estado; cada venta permite abrir detalle y anular. Inicio
resume las ventas registradas del día, excluyendo anuladas de ingresos y unidades.
El historial de inventario permanece separado, filtrable por producto y tipo.

## Base y migraciones

La base `clown-ufo-catalog` está en versión 8:

| Versión | Cambio aditivo |
| --- | --- |
| 1 | `products`, `categories`, `movements` |
| 2 | `costChanges`: auditoría del costo estimado |
| 3 | `sales`, `payments`, `metadata`, `events` reales |
| 4 | `families`, `ips`; copia histórica de categorías y asociaciones por ID |
| 5 | Categoría principal recuperada por UUID; categoría pendiente si no verificable; índice de nombres de categorías |
| 6 | `promotions`, vacío; no reescribe registros existentes |
| 7 | Marcador de combos/packs; campos opcionales compatibles |
| 8 | `managedEvents` vacío, índice único de evento activo; `events` legacy conservado |

No se eliminan ni reinician datos previos. La versión 4 añade asociaciones a los productos sin modificar sus demás campos. Se conservan IDs, imágenes,
categorías, movimientos y auditoría de costos. No se insertan productos ni eventos
de demostración en la base. Eventos muestra exclusivamente eventos administrados
reales en `managedEvents`; `events` se conserva como respaldo legacy y nunca se
convierte automáticamente. La venta lee el evento activo al confirmar y se guarda
sin evento cuando no hay ninguno. Referencias anteriores permanecen históricas.

`estimatedUnitCost` sigue siendo un campo manual independiente: desconocido y
cero son distintos, cambiarlo genera auditoría en la misma transacción del
producto, y las reposiciones solo lo sugieren sin sobrescribirlo. El cálculo de
promedio ponderado existente se mantiene; descuentos, ventas y anulaciones no
reescriben movimientos ni costos históricos. Las imágenes son Blob locales y
Fraunces se sirve desde `public/fonts/` con su licencia OFL.

## Persistencia y operación offline

Los datos son locales al perfil del navegador y al origen completo (protocolo,
hostname y puerto). `127.0.0.1:5173`, `localhost:5173` y otro puerto son catálogos
distintos. No hay localStorage, sincronización, autenticación ni respaldo cloud.
Borrar datos del sitio o finalizar una sesión privada puede borrar el catálogo.

Venta, anulación y demás operaciones no requieren red una vez cargada la interfaz.
No se añade service worker: abrir desde cero sin servidor/cache de la aplicación
todavía requiere una etapa posterior de PWA. Persistencia de datos y disponibilidad
de la interfaz sin servidor son aspectos separados.

## Archivos principales

- `src/services/salesRepository.ts`: confirmación y anulación atómicas.
- `src/services/saleRules.ts`: stock limitado a disponibilidad y copias de costo.
- `src/types/sales.ts`: modelos de venta, pagos y revisión de checkout.
- `src/components/Checkout.tsx`: revisión, costos y pagos.
- `src/components/SaleDetail.tsx`: copia histórica y anulación.
- `src/components/StoredSaleList.tsx`: listado real compartido.
- `src/screens/History.tsx`: filtros de ventas persistentes.
- `src/services/catalogDatabase.ts`: migraciones acumulativas.
- `tests/sales.test.ts`: cobertura de la Etapa 3.

## Verificación

Build, lint y 159 pruebas pasan. Se mantienen las anteriores de catálogo y costos.
Las nuevas cubren ventas normales, stock insuficiente/cero/negativo, varios
productos, los tres métodos, pagos divididos exactos e incorrectos, doble
confirmación, reintentos, fallos de almacenamiento con rollback, reapertura de
conexión, snapshots tras cambiar nombre/precio/costo o archivar, anulación con
y sin devolución, anulación duplicada y fallida, eventos reales/no evento y
migración 2 → 3. Confirmación y anulación también se prueban con `fetch` bloqueado.

La prueba UI se ejecutó aislada en `127.0.0.1:5174`. Se vendieron 8 unidades con
stock 7, pago dividido $20.000 + $36.000, costo estimado $0 y sin evento. Volver
conservó los datos y una suma incorrecta bloqueó confirmar. Con el servidor
detenido se confirmó la venta y se anuló devolviendo solo 7 unidades. Se comprobaron
el historial real y filtros de fecha, evento y estado. Recarga y nueva pestaña
conservaron venta y auditoría. No se reinició completamente la aplicación del
navegador ni se desactivó la red del equipo; esa comprobación manual queda pendiente.

No se implementan nube, promociones, combos, importaciones ni informes avanzados.

## Etapa 3.5

El historial de inventario conserva filtros y usa contenido desplazable con
encabezado fijo, X, Escape, clic exterior y Volver en móviles. Los formularios
piden confirmar el descarte de cambios y bloquean el cierre durante escrituras.
La acción Anular venta está en el encabezado del comprobante; al activarla se
enfoca el motivo. Se mantiene la transacción y la auditoría existentes.
Inventario ofrece Activos, Archivados y Todos; Reactivar también está disponible
como acción directa. Se actualiza el mismo registro, sin cambiar su UUID.

Verificación manual en origen aislado 5174: pago sin costo manual; venta de 8
con stock 7; apertura desde Historial, protección del motivo ante Escape,
anulación con devolución de 7 y sin devolución, persistencia del estado, conservación del costo/pagos; archivo, exclusión
del POS, filtros y reactivación persistente al recargar; cierres X/Escape/exterior
y Volver en móvil, incluyendo desplazamiento largo. No se modificó la base de 5173.
Los tests de cierre verifican la política pura de bloqueo/descarte; la interacción
DOM se comprobó manualmente en el navegador.

El pago muestra siempre Efectivo, Transferencia y Débito. Inicialmente se asigna
el total a Efectivo; los otros importes son cero. Vacío equivale a cero. Solo se
guardan métodos con importe positivo; una venta gratuita puede no tener pagos.
Se informa faltante/exceso y el total permanece en el encabezado. Enter dentro
de los campos no confirma la venta. Los borradores conservan importes al volver.

## Etapa 4: Familias e IPs

Inventario → Organizar catálogo permite administrar Familias e IPs de manera
independiente: UUID estable, nombre normalizado, descripción, orden, archivo,
reactivación, búsqueda y cantidad de productos asociados (incluye archivados).
Los nombres nuevos y renombrados son únicos por entidad, incluso entre archivadas.
La validación y escritura usan la misma transacción para evitar duplicados
concurrentes; las ediciones verifican la fecha de modificación anterior.

La migración v4 se ejecuta en una transacción versionchange: copia las categorías
a Familias reutilizando sus UUID, nombres, orden, estado y fechas; añade familyIds
a los productos y deja ipIds vacío. Conserva categories y categoryIds como respaldo
legado. No toca ventas, pagos, costos, imágenes ni movimientos. Si falla, se aborta
la migración completa; al reabrir se reintenta. Una actualización completada no se
repite y reutiliza claves estables. saveCategory queda solo por compatibilidad con
integraciones anteriores; la interfaz nueva usa classificationRepository.

Versiones anteriores admitían nombres repetidos en categorías archivadas. Si
existían, se preservan ambos registros y se muestran como duplicados heredados;
pueden renombrarse. No se crean duplicados nuevos ni se reactiva un duplicado con
el mismo nombre. No se cambia silenciosamente el nombre ni se fusionan IDs.

Los productos admiten múltiples familyIds e ipIds o listas vacías. Los selectores
están plegados, tienen búsqueda y una lista con desplazamiento interno; muestran
selecciones como etiquetas removibles. Una clasificación archivada conserva sus
asociaciones y es consultable en filtros, pero no se ofrece para asignaciones
nuevas. Las asociaciones se validan dentro de la transacción del producto.

Inventario y POS combinan OR dentro de cada selección y AND entre Familias e IPs.
Inventario añade estado y búsqueda por producto/clasificaciones; POS busca por
nombre del producto. Limpiar filtros no toca el carrito. Los IDs permiten futuras
promociones por producto, Familia o IP, sin implementar descuentos en esta etapa.

Archivos principales: src/types/catalog.ts; src/services/catalogDatabase.ts,
catalogRepository.ts, catalogValidation.ts, classificationRepository.ts y
catalogClassification.ts; src/hooks/CatalogProvider.tsx y catalogContext.ts;
src/components/catalog/ClassificationManager.tsx, ClassificationSelect.tsx y
ProductForm.tsx; src/screens/Inventory.tsx, PointOfSale.tsx y Home.tsx; src/App.css.
Tests nuevos en tests/classification.test.ts; se actualizaron las expectativas
de migración en costs-migration.test.ts y sales.test.ts conservando sus controles.

Verificación manual aislada en 5174: migración de familia archivada y asociación
previa; altas, edición de descripción/orden/nombre, rechazo de duplicados,
archivo/reactivación de ambas entidades; dos Familias y dos IPs en móvil sin
cambios en stock/precio/costos; filtros combinados conservando carrito; venta
posterior y ventas anteriores; estado Archivados con filtros y reactivación;
recarga y cierre/reapertura de pestaña con asociaciones persistentes. No se
insertan fixtures ni productos demo en la base del usuario. El reinicio completo
del proceso del navegador sigue pendiente de una comprobación manual externa.

## Etapa 4.5: Categorías, Familias e IPs independientes

Categoría principal: un categoryId obligatorio para productos nuevos y al guardar
ediciones. Familias: familyIds múltiples opcionales. IPs: ipIds múltiples opcionales.
Las categorías son formatos físicos; las familias colecciones comerciales; las
IPs universos creativos. Guardar una categoría ya no crea ni modifica familias.
Organizar catálogo tiene tres apartados y controles independientes de creación,
edición, descripción, orden, búsqueda, archivo y reactivación. Los nombres se
validan dentro de cada tipo, incluyendo registros archivados.

La migración v5 conserva el almacén categories original. Añade su índice by-name
y normalizedName, y recupera categoryId usando UUIDs históricos de categoryIds o
familyIds que existan en categories. No usa coincidencias de nombres. Si hay una
sola categoría verificable se asigna como principal; si hay varias o ninguna se
marca classificationPending sin inventar una categoría ni elegir arbitrariamente.
Se mantienen todas las familias, IPs y asociaciones actuales, incluidos los IDs
compartidos históricamente entre categorías y familias (son almacenes distintos).
categoryIds se mantiene como respaldo histórico. No se reescriben ventas, pagos,
anulaciones, movimientos, imágenes, costos ni revisiones de productos.

Los productos pendientes se pueden consultar y vender con el comportamiento
existente; para guardar una edición deben seleccionar categoría. Las asociaciones
archivadas existentes se conservan pero no se ofrecen para nuevas asignaciones.

Cada selector del formulario tiene + para abrir una creación compacta dentro del
mismo modal. El formulario de producto conserva su estado en React: nombre,
descripción, imagen, precio, stock y costos. Crear y seleccionar espera la
transacción, refresca datos, selecciona el nuevo UUID y vuelve al producto. Los
errores no borran campos. Volver al producto cancela únicamente la creación rápida;
las categorías creadas siguen siendo registros independientes si luego se cancela
la edición del producto.

Inventario y POS combinan Categoría, Familias, IPs y nombre. Los grupos son AND,
y dentro de cada grupo se permite OR. Modificar filtros no toca el carrito. Las
etiquetas de catálogo identifican cada tipo por separado. No hay promociones.

Pruebas nuevas: tests/classification45.test.ts. Las pruebas anteriores usan
fixtures explícitas con categoría (tests/catalogFixture.ts) y mantienen todos
sus controles financieros, de costos y atomicidad. Estas fixtures no se insertan
en la aplicación. Se probaron migraciones desde v1/v2/v3/v4, incluyendo reversión
ante fallo, recuperación por UUID, ambigüedad, y ausencia de inferencia por nombre.

Comprobación manual aislada en 5174: rechazo de producto sin categoría; creación
rápida de los tres tipos y selección automática; conservación de nombre,
descripción, precio 4200, stock 2 y costo inicial 1000; duplicado con error visible;
dos familias y dos IPs; filtros combinados sin perder carrito; venta V-000006;
recarga y reapertura de pestaña; administración separada y archivo/reactivación
con orden de categoría. El reinicio completo del navegador continúa pendiente de
una comprobación externa. Ningún fixture se introdujo en el origen principal.

## Etapa 5.1: Descuentos manuales

Cada línea del carrito y el resumen de venta tienen una acción discreta Agregar
descuento, con edición y eliminación. Se aplica a toda la línea (precio original
por cantidad), nunca al precio del catálogo. Tipos: porcentaje entre 0 y 100 con
hasta dos decimales, o monto fijo entero CLP. Un monto mayor al importe disponible
se rechaza, sin recortarlo. Vacío o inválido no se aplica. Si un cambio de cantidad
hace inválido un descuento, el carrito lo informa y bloquea el pago hasta corregirlo.

Orden: descuentos individuales primero; descuento general después sobre la suma
restante. Porcentajes se calculan con puntos básicos y BigInt; cada descuento se
redondea al peso más cercano, con mitades hacia arriba. El general se redondea
una sola vez sobre el subtotal restante. No se reparte el descuento general entre
líneas ni se modifica el precio unitario. Un 100 % puede producir una venta cero,
con stock descontado normalmente y sin métodos de pago de importe cero.

El servicio vuelve a calcular todo dentro de la transacción, comprueba revisión y
precio, exige pagos exactos y guarda con stock/movimientos/pagos de forma atómica.
La deduplicación incluye los descuentos en la huella de la operación. No cambia
el cálculo de costos ni la regla de stock insuficiente. Anular conserva descuentos
y pagos; devuelve únicamente stock efectivamente descontado si se solicita.

Histórico: unitPrice y lineTotal conservan precio original e importe bruto;
netLineTotal es el importe después del descuento individual y antes del general;
appliedDiscount guarda source manual, tipo, valor, base e importe aplicado.
subtotal es original; discount es la suma de descuentos; generalDiscount guarda
su copia; total es final. calculationVersion manual-v1 identifica la política.
IndexedDB continúa en versión 5: campos opcionales, sin migración ni reescritura
de ventas antiguas. El detalle usa lineTotal cuando falta netLineTotal.

El pago utiliza el total final con Efectivo/Transferencia/Débito. Al volver se
conservan importes si el total no cambió; si cambió, se inicializan otra vez con
total en Efectivo para evitar cobrar un borrador correspondiente a otro importe.
Carrito y descuentos pendientes siguen siendo temporales, como antes.

Archivos: src/types/discounts.ts, index.ts y sales.ts; src/services/discountRules.ts
y salesRepository.ts; src/hooks/useCart.ts; src/components/DiscountEditor.tsx,
Checkout.tsx, SaleDetail.tsx y StoredSaleList.tsx; src/utils/discounts.ts;
src/screens/PointOfSale.tsx; src/App.css; tests/discounts.test.ts; README.md.
No hay motor automático, promociones, combos ni packs.

86 tests cubren casos previos y 14 nuevos de descuentos: sin descuentos, tipos por
línea y generales, combinación, 100 %, redondeo, rechazos, pagos divididos,
persistencia, cambios posteriores de precio, anulación, ventas anteriores y
operaciones sin APIs de red. Comprobación móvil aislada en 5174: bruto 8400,
descuento por línea 25 % (2100), general fijo 630, total 5670; pagos 2000/2000/1670;
edición/eliminación, rechazo de monto 7000, confirmación y anulación con servidor
detenido, recarga y comprobante persistente. Ningún fixture fue añadido a 5173.

## Etapa 5.2: Promociones automáticas

Inventario → Organizar catálogo → Promociones permite crear, consultar/editar,
activar/desactivar, archivar/reactivar y buscar/filtrar promociones persistentes.
Incluye nombre, descripción, tipo/valor, cuatro grupos de destinatarios, mínimos,
fechas y acumulación. Las promociones nuevas comienzan inactivas. Reactivar una
archivada conserva UUID y configuración y la deja inactiva hasta activar.
La edición verifica updatedAt y la activación comprueba el límite dentro de una
transacción. Nunca se eliminan promociones referenciadas: solo se archivan.

Reglas exactas promotions-v1:

1. OR dentro de cada lista de productos/categorías/familias/IPs, AND entre grupos.
   Una lista vacía es comodín. Cada línea usa las asociaciones actuales por UUID.
2. Mínimos: suma de unidades y de importes originales de líneas elegibles, antes
   de cualquier descuento. No dependen del stock disponible: las reglas de venta
   y diferencia no cubierta permanecen iguales.
3. Fechas de calendario opcionales, inclusivas, en America/Santiago. Activa es
   configuración; vigente además requiere cumplir fechas y no estar archivada.
4. Manual por línea → promociones → manual general. No se altera el catálogo.
   Todos los manuales se conservan y son compatibles con promociones. Si un
   manual general fijo queda por encima del saldo, esa combinación automática
   se descarta; puede ganar otra o ninguna. Nunca se recorta el manual.
5. Dos promociones que comparten una línea elegible son compatibles solo si
   ambas son acumulables. Promociones sobre líneas elegibles disjuntas siempre
   son compatibles. Cada promoción se aplica una sola vez por venta, a todas
   sus unidades elegibles; no se divide una línea en grupos de unidades.
6. Cada combinación aplica promociones por UUID ascendente. Porcentaje sobre
   el saldo elegible actual; fijo una vez sobre ese conjunto, limitado al saldo.
   El valor configurado original y el importe realmente aplicado se guardan.
7. Redondeo al peso más cercano, mitades hacia arriba, BigInt y puntos básicos,
   igual que 5.1. El importe promocional se reparte proporcionalmente entre las
   líneas: piso entero y pesos restantes por mayor residuo, empate por UUID.
8. Se exploran todas las combinaciones compatibles. Gana el menor total final,
   incluyendo el manual general; empate: menos promociones efectivamente
   aplicadas y luego secuencia lexicográfica de UUID. Se ignoran beneficios de
   importe cero. El resultado es independiente del orden de entrada.

Límite explícito: hasta 12 promociones configuradas activas y no archivadas,
incluidas las programadas fuera de vigencia. Pueden existir ilimitadas inactivas
(o archivadas). El límite garantiza búsqueda exacta acotada a 4096 subconjuntos;
no hay selección aproximada ni descarte silencioso. Este motor trabaja por líneas
completas y no implementa fraccionamiento de unidades, repetición de beneficios,
combos, packs, ni horarios intradía. Las fechas usan días completos. El reloj del
POS se refresca cada 30 segundos y al recuperar foco; cantidades/productos se
recalculan inmediatamente. El dispositivo determina el reloj, sin conexión externa.

El modal de pago recibe la copia del cálculo del carrito; no añade pasos. La
confirmación vuelve a leer promociones y productos en la misma transacción que
ventas, pagos y stock. Una firma del cálculo detecta cambios/vencimientos durante
el pago y pide revisar el carrito, sin guardar parcialmente. Los reintentos de
una operación ya confirmada devuelven la misma venta, aunque luego cambien reglas.
Los manuales, pagos divididos, ventas cero y anulaciones mantienen su comportamiento.

Histórico: appliedPromotions guarda id, nombre, tipo, valor, importe, productos/
cantidades/reparto y configuración completa. Cada línea guarda promotionDiscount
y netLineTotal después del manual y de promociones, antes del general. Las ventas
previas sin esos campos siguen legibles. Editar/archivar promociones no cambia
ventas antiguas; anular conserva todas las copias y pagos. IndexedDB v6 agrega solo
el almacén promotions vacío, sin fixtures ni reescribir datos existentes.

Archivos nuevos: src/types/promotions.ts; src/services/promotionRules.ts y
promotionRepository.ts; src/components/catalog/PromotionManager.tsx;
tests/promotions.test.ts. Integraciones: catalogDatabase.ts, salesRepository.ts,
types/sales.ts, hooks/CatalogProvider.tsx, catalogContext.ts, useCart.ts,
ClassificationManager.tsx y ClassificationSelect.tsx, Inventory.tsx,
PointOfSale.tsx, Checkout.tsx, SaleDetail.tsx y App.css. Se actualizó la expectativa
de versión de migración de tests/classification45.test.ts.

Build, lint y 111 pruebas pasan (25 nuevas de promociones). Cubren criterios,
fechas/Chile, mínimos, acumulación, competencia/desempate, manuales, retirada,
cero, reparto entero, límite concurrente, persistencia, cambios durante pago,
historial/anulación, migración v5→v6, APIs de red deshabilitadas y compatibilidad.
Prueba manual aislada en 5174: cuatro grupos intersectados, mínimo 2 unidades y
8000 CLP; promoción entra/sale al cambiar cantidades; 10 % manual + 20 % automático
+ 48 CLP general dan 6000 de un bruto 8400. Pagos 2000/2000/2000. Guardado,
edición/desactivación/archivo/reactivación y anulación con servidor detenido;
historial mantiene la promoción original 20 % tras editarla a 5 %. Recarga confirma
persistencia. No se introducen fixtures en 5173. El funcionamiento offline requiere
la aplicación ya cargada, como en las etapas anteriores.

## Etapa 5.3: Combos automáticos y packs físicos

Los combos se administran como promociones de tipo Combo. Cada componente
identifica por UUID un producto específico o una categoría principal y exige
una cantidad positiva. No depende de nombres ni crea productos/líneas ficticias.
El POS reconoce grupos completos, múltiples aplicaciones y distintos SKU de una
misma categoría; quitar unidades retira los beneficios que dejan de cumplirse.
Las promociones nuevas siguen comenzando inactivas. Fechas inclusivas en Chile.

Reglas exactas combos-v1 (extienden promotions-v1 cuando hay combos posibles):

1. Precio original → manual por línea → combos y promociones seleccionados
   conjuntamente → manual general. Se exploran todas las asignaciones y
   subconjuntos compatibles dentro del presupuesto explícito, nunca una
   elección codiciosa de combos seguida de descuentos aislados.
2. Una unidad puede pertenecer a un solo combo, incluso si ambos permiten
   acumulación. Acumulable en un combo significa que admite una promoción
   tradicional sobre sus unidades solo cuando esa promoción también es
   acumulable. Beneficios en unidades disjuntas siempre son compatibles.
3. Las promociones incompatibles con un combo pueden usar las unidades libres
   del mismo SKU. Sus mínimos se evalúan sobre esas unidades elegibles y sus
   importes originales. Las promociones tradicionales mantienen su aplicación
   única a todo el conjunto elegible; no se subdividen arbitrariamente para
   aplicar promociones competidoras a partes de ese conjunto.
4. Cada combo reduce el saldo de sus unidades, después de manuales, hasta el
   precio fijo configurado. No añade otra vez el ahorro calculado sobre el
   bruto. Se omite si el precio es igual/superior al importe original o al saldo
   después de manuales. Los manuales nunca se eliminan ni recortan. Si el manual
   general fijo supera el saldo, esa combinación automática es inválida.
5. Dentro de cada combinación: combos por UUID ascendente, luego promociones
   tradicionales por UUID ascendente. Las unidades equivalentes se agrupan por
   SKU y saldo inicial para evitar permutaciones redundantes sin aproximación.
   Se evalúa también no aplicar combos y terminar después de cada aplicación.
6. Gana el menor total final, incluyendo el manual general. Empate: menos
   beneficios efectivos (cada aplicación de combo cuenta uno); luego secuencia
   lexicográfica de UUID/asignaciones, con unidades ordenadas por UUID de
   producto y ordinal. El orden de entrada del carrito no cambia la selección.
7. Porcentajes: pesos enteros, mitades hacia arriba, como 5.1. El ahorro de un
   combo se reparte proporcionalmente al saldo de los productos utilizados:
   piso entero, pesos restantes por mayor residuo, empate por UUID. Dentro
   de cada línea se aplica el mismo reparto entre sus unidades. El manual de
   línea se distribuye primero por cociente/residuo (pesos extra al ordinal
   menor). Todos los importes repartidos suman exactamente el ahorro.

Límites de esta versión: 12 promociones activas incluyendo combos; 4 componentes
por combo; 8 unidades por aplicación; 24 unidades del carrito elegibles para los
combos vigentes; 128 asignaciones distintas por combo y estado de unidades
restantes; 20.000 pasos compartidos entre generación de asignaciones, búsqueda
recursiva de combos y subconjuntos de promociones. Son presupuestos de búsqueda
exacta para mantener respuesta táctil/offline, no restricciones del inventario.
Las unidades ajenas a combos no se expanden ni consumen el límite de 24.
La administración muestra estos límites y valida componentes/unidades; el POS
muestra un error explícito y bloquea cobro si se supera el presupuesto. Se debe
simplificar/desactivar reglas o reducir el carrito. Nunca se cobra con una
aproximación ni se ignoran reglas silenciosamente. No hay horarios intradía.

Packs: nuevo tipo al crear un producto, con precio, clasificación, imagen, costos
propios, stock y movimientos independientes. Los existentes sin kind se leen
como productos normales. El tipo no se convierte en la edición para evitar
reinterpretar existencias históricas. El contenido es documentación opcional por
UUID/cantidad; no ensambla ni transfiere stock. Venta y anulación solo modifican
el pack. Puede recibir los mismos descuentos que cualquier otro producto.

Ventas: appliedCombos guarda configuración completa, UUID/nombre, precio fijo,
número de aplicaciones, bruto, ahorro, productos/cantidades/reparto agregado y
por aplicación. Las líneas originales conservan precio y cantidad; descuento
automático incluye combos y promociones. Los packs copian su tipo y contenido
con nombres históricos. Se relee configuración dentro de la transacción de venta
junto con costos/stock/pagos; firma de revisión detecta cambios durante el cobro.
Reconocer ofertas nunca escribe inventario. Una venta crea un movimiento normal
por SKU; escasez y devolución mantienen el descuento efectivo de stock. Anular
conserva ofertas y pagos históricos y no procesa reembolsos monetarios.

IndexedDB v7: conserva todos los almacenes y filas sin reescribirlos. Solo añade
el marcador combos-packs-v1 en metadata dentro de la misma transacción versionada,
encadenado a migraciones anteriores y con rollback ante fallo. Nuevos campos son
opcionales; no se inventan tipos ni combos en ventas anteriores. Los UUID se
mantienen. No se requiere nuevo almacén: combos viven en promotions y packs en
products. Reapertura es idempotente.

Módulos nuevos: services/comboRules.ts (motor puro), promotionConditions.ts
(validación/condiciones compartidas), tests/combos.test.ts. Cambios: tipos catalog,
promotions y sales; catalogDatabase, catalogValidation, catalogRepository,
promotionRepository, promotionRules y salesRepository; ProductForm,
PromotionManager, Inventory, PointOfSale, Checkout, SaleDetail, utils/discounts y
App.css. Ajustes de pruebas sales y classification45 para metadata/versión.

Validación: build, lint y 126 pruebas (15 nuevas con múltiples escenarios).
Cubren los 20 casos solicitados: completos/incompletos/repetidos, categoría con
SKU distintos, competencia global, compatibilidad, manuales, retirada, escasez,
venta/anulación, packs propios, persistencia, copias históricas, ventas antiguas,
pagos divididos, cero y prevención de consumo/confirmación duplicados. También
límites de configuración, unidades, asignaciones y pasos, redondeo, migraciones,
referencias inválidas de packs y rollback. Se conservan las 111 pruebas previas.

Comprobación manual aislada en origen 5174 (sin escribir fixtures en 5173): crear
combo 1 producto de 7000 + 2 de 1500 a 7500, comprobar retirada/restauración al
cambiar cantidades, pagar 2500/2500/2500, consultar reparto 1750/750 y anular con
servidor detenido sin devolver las 2 unidades no cubiertas. Crear pack con 10
unidades y contenido documentado 5 stickers; vender 2 en móvil 390×844 con servidor
detenido: stock 8, componentes sin cambios; anular devuelve a 10. Edición del
pack conserva contenido/costos/stock. Editar y archivar combo a otro precio
mantiene nombre/precio/descuento histórico originales. Recarga y cierre/reapertura
de pestaña conservan ventas, packs y stock. No se probó reinicio completo del
proceso del navegador. Evidencia: artifacts/etapa-5-3-historial.png. El uso sin red
requiere la aplicación previamente cargada, como antes; no se añadió service worker.

## Etapa 6.1: Eventos reales y asociación automática

Modelo CatalogEvent: UUID estable, nombre obligatorio, descripción/ubicación
opcionales, startDate/endDate como días YYYY-MM-DD, estado upcoming/active/finished,
createdAt/updatedAt y activatedAt/finishedAt cuando corresponde. Fechas válidas,
término no anterior al inicio, nombre hasta 120 caracteres. Las etiquetas se
construyen en calendario local al mediodía, sin interpretar el día como UTC.
Marcas de auditoría siguen siendo instantes ISO, con presentación en Chile.

Eventos permite crear, editar información, buscar nombre/ubicación/descripción,
filtrar estados, consultar detalles, activar, desactivar y finalizar explícitamente.
No hay eliminación de eventos, tengan o no ventas. Nuevo evento comienza próximo.
Solo uno puede estar activo: índice único active-event en activeKey y operaciones
transaccionales. Cuando ya hay uno activo, se confirma desactivar el anterior
(sin finalizarlo) y activar el nuevo en una sola transacción. Si otra pestaña
cambió el anterior desde la confirmación, se rechaza sin cambios y debe revisarse
nuevamente. Edición usa updatedAt para rechazar sobreescrituras obsoletas.
Doble clic bloqueado y reintento de creación con el mismo UUID no crea duplicados.
Los errores se muestran y el éxito espera tx.done; fallo durante cambio de activo
revierte también la desactivación anterior.

Decisiones: estados manuales, independientes de fechas; desactivar devuelve a
próximo y conserva la última activación. Finalizar es irreversible desde los
servicios y la interfaz, registra finishedAt y libera el activo. Un finalizado
puede corregir nombre/ubicación/fechas/descripción, conservando estado y auditoría;
no puede reactivarse. No hay activación por horario, cierre financiero ni gastos.

Inicio conserva el cartel rosa/carpa/tickets y muestra datos del evento real.
Navegación, Eventos y POS leen el mismo estado persistente. Sin activo se muestra
un estado vacío con acceso a Eventos; ningún ejemplo se usa para llenar espacios.
Pago no tiene selector de evento ni un paso nuevo. Su aviso se actualiza entre
pestañas, pero la fuente definitiva siempre es IndexedDB al confirmar.

SalesRepository incluye managedEvents en la misma transacción que ventas, pagos,
stock, movimientos y promociones. Lee el índice del activo y copia UUID/nombre
histórico. Activación y finalización bloquean ese mismo almacén; gana el orden real
de inicio de las transacciones, no el orden de invocación de promesas. Una conexión
previamente abierta puede iniciar antes que otra que se está abriendo. Nunca se
usa el evento copiado al agregar al carrito o al abrir el pago. Sin activo la
venta se registra sin evento. Reintentar una operación confirmada devuelve su
venta/evento originales. eventId del contrato anterior solo se conserva para
firmas de reintentos legacy; las nuevas ventas ignoran esa selección externa.

Historial filtra por eventos reales (incluidos próximos/finalizados) o sin evento.
Si una venta anterior referencia un ID ausente de managedEvents, se ofrece su
nombre con etiqueta histórico, sin crear un evento. En comprobantes y listas se
usa siempre el nombre histórico, aunque la administración ya tenga otro nombre.
Anular conserva la asociación original y todos los importes/costos/beneficios.

Migración IndexedDB v7→v8: agrega managedEvents vacío e índice único active-event.
No convierte eventos ficticios ni registros mínimos legacy; conserva events
anterior como respaldo. No elimina ni reescribe ventas, pagos, productos,
clasificaciones, costos, imágenes, promociones, combos ni movimientos. No cambia
UUID. Las referencias antiguas siguen intactas. Migración atómica e idempotente,
incluso ante un fallo de creación del almacén. Los servicios y UI refrescan cambios
entre pestañas por BroadcastChannel; foco permite refrescar si no está disponible.

Archivos nuevos: types/events.ts, services/eventRules.ts y eventRepository.ts,
components/events/EventForm.tsx, tests/events.test.ts. Modificados: catalogDatabase,
salesRepository, types/sales, hooks/catalogContext y CatalogProvider, screens/Events,
Home, History y PointOfSale, navigation/Navigation, components/Checkout, App.tsx,
App.css, README y expectativas de tests/sales, classification45 y combos.

Pruebas: build, lint y 142 pruebas (16 nuevas). Cubren los 18 casos solicitados:
creación/reintento/validación, días en Santiago/UTC/Kiritimati/Los Ángeles, edición
obsoleta, activación única y concurrencia, cambio con confirmación, rollback por
cuota, finalización irreversible, evento elegido al confirmar, nombre histórico,
anulación, filtros de finalizados/legacy/sin evento, reapertura, red deshabilitada,
migración v7→v8 con rollback y todas las filas anteriores intactas. Se mantienen
las 126 pruebas anteriores, ajustando versión y la antigua selección de evento.

Comprobación manual en origen aislado 5174: creación de dos eventos, activación,
Inicio y POS con evento real. Pago abierto en una pestaña mientras otra cambia
activo: la confirmación registra el nuevo. Editar su nombre y finalizarlo no
cambia el comprobante V-000011; filtro por nombre actual encuentra la venta con
nombre histórico. Servidor detenido: finalizar/activar/editar eventos, venta sin
evento V-000012 y anulaciones con devolución. Revisión móvil 390×844 del formulario,
búsqueda y filtro de finalizados; no ofrecen reactivación. Recarga y cierre/reapertura
de pestañas conservan estados, ubicación editada y ventas. Pruebas QA no escriben
fixtures en 5173. Evidencia: artifacts/etapa-6-1-inicio.png.

Limitaciones: datos locales sin respaldo cloud; offline requiere interfaz ya
cargada, no se incorporó service worker. No se comprobó reinicio completo del
proceso del navegador. No hay reglas de precios por evento, gastos, estadísticas
avanzadas, comparación, cierre financiero ni sincronización.

## Etapa 6.2: Precios especiales por evento

El producto conserva price como precio general y añade eventPrices opcional:
lista de { eventId, price }, asociada por UUID. Su ausencia es equivalente a
ninguna excepción. Los precios se administran exclusivamente en Crear/Editar
producto, desde el desplegable Precios por evento debajo de Precio general (CLP).
Permite añadir, modificar y quitar excepciones; los cambios se guardan al guardar
el producto, junto con sus campos, sin cambiar stock ni costos históricos.
No existen controles de precios en Eventos ni en el pago. La selección evita
eventos repetidos y el repositorio valida duplicados y existencia en managedEvents.
Todos los importes son enteros CLP de 0 a 1.000.000.000, como el catálogo general;
0 se conserva explícitamente. Se pueden configurar eventos próximos, activos o
finalizados existentes; solo el activo interviene en precios. Finalizados siguen
sin poder activarse. Nuevas filas parten del precio general como valor editable.

Resolver puro productPricing.ts: con activo y excepción, usar esa excepción;
con otro evento, sin activo o sin excepción, usar el precio general. No modifica
el producto. Una excepción puede ser menor, igual o mayor que el precio general:
es un precio alternativo, no un descuento. Todos los manuales, mínimos de compra,
promociones y combos calculan sobre precios efectivos. Stock y costo automático
mantienen sus reglas; los packs siguen con existencias independientes.

Tarjetas POS, carrito y revisión del pago muestran precio efectivo y la indicación
Precio de evento si corresponde. Cambiar de evento recalcula el carrito manteniendo
SKU, cantidades y descuentos configurados. Un manual fijo que exceda el nuevo
importe conserva su valor y bloquea el pago con error, como 5.1; no se recorta.
El total puede llegar a cero con precio especial 0 o descuentos válidos, y los
pagos deben sumar exactamente ese total. No se añaden pasos obligatorios.

Revisión del cobro: al entrar copia precios efectivos, contexto del evento,
revisiones de productos y cálculo promocional. Cambios detectados bloquean
Confirmar venta y piden volver al carrito. El contexto usa UUID activo + contador
persistente event-price-revision en metadata; cada activación/cambio/desactivación/
finalización del activo incrementa el contador dentro de su misma transacción.
Así A→B→A o sin evento→activo→sin evento también invalida una revisión antigua,
aunque el precio o evento final coincidan. Crear eventos, editar su información o
finalizar uno inactivo no cambia el contexto de precio. Cambios de productos o
promociones se detectan además con revisión/firma. El borrador de pagos sigue
siendo temporal y conserva importes cuando el total revisado coincide.

La confirmación vuelve a leer activo, contador y productos dentro de la transacción
existente. Verifica priceReview, revisión de producto y precio efectivo, calcula
ofertas sobre ese precio y valida pagos antes de escribir. Cambios concurrentes
rechazan sin guardar venta/stock/pagos parciales; UI recarga catálogo tras errores
para permitir revisión fresca. El ID de operación/reintento conserva idempotencia.
Las llamadas legacy sin priceReview mantienen compatibilidad; igualmente deben
coincidir con el precio vigente y revisión de producto. El POS siempre envía revisión.

Cada línea nueva guarda unitPrice efectivo, priceSnapshot { unitPrice, generalPrice,
source: general/event, eventId cuando excepción } y los importes/descuentos del
momento. La venta conserva UUID/nombre histórico del evento. Editar/eliminar
excepciones, cambiar precio general o finalizar/renombrar eventos no cambia el
comprobante. Anular conserva snapshots, pagos y ofertas y devuelve únicamente
stock efectivamente descontado. Ventas anteriores sin priceSnapshot siguen
legibles, sin inventar su origen ni reescribirlas.

IndexedDB sigue en v8: no se necesita almacén, índice ni migración versionada.
Campos opcionales se escriben solo al crear/editar productos o confirmar nuevas
ventas. Abrir/reabrir no añade valores ni reescribe datos; contador ausente se lee
como 0 y se crea al próximo cambio de activo. Events no almacena precios ni
administra excepciones. UUID, clasificaciones, imágenes, costos, stock, movimientos,
ventas, promociones, combos y packs existentes se conservan. Fallo del contador
revierte también el cambio de estado, sin dejar revisión/evento incoherentes.

Archivos nuevos: services/productPricing.ts, components/catalog/EventPricesEditor.tsx,
tests/eventPrices.test.ts. Modificados: types/catalog y sales; catalogValidation,
catalogRepository, eventRepository y salesRepository; hooks/catalogContext,
CatalogProvider y useCart; ProductForm, Checkout, Modal, SaleDetail, PointOfSale,
App.css y README. Modal admite detectar cambios de excepciones hechos solo con
botones para proteger cierres sin guardar.

Verificación automatizada: build, lint y 159 pruebas (17 nuevas). Resolver con/sin
excepción, otro/sin evento y cero; validaciones y duplicados; edición/eliminación
sin cambiar inventario/costos; recálculo conservando manuales/cantidades; cambio
durante pago incluso con mismos importes e ida/vuelta; rollback de revisión;
cero sin pagos; combinación manual + combo + promoción + general con precios
efectivos y pagos divididos; edición durante cobro; copias históricas, reintento,
escasez/anulación; v8 sin reescritura; persistencia y APIs de red deshabilitadas;
pack con stock propio. Se conservan las 142 pruebas anteriores, incluida migración.

Prueba manual en origen QA 5174: pack general 6000 y excepción 5000 para Feria QA
Octubre; 2 unidades con 10% manual dan 9000. Otra pestaña cambia a evento sin
excepción: pago anterior queda bloqueado; volver conserva 2 unidades/10% y calcula
10800. Revisión nueva tras volver al evento original permite cobrar 3000/3000/3000.
Con servidor detenido se guarda V-000013; cambiar excepción a 0 no cambia su copia
histórica 5000/general6000. Venta V-000014 de total cero no guarda pagos; eliminar
excepción no altera su historial. Ambas anulaciones preservan importes y reponen
solo stock de packs. El cierre tras quitar excepción sin guardar exige confirmación.
Creación móvil 390×844 con general2500, dos excepciones 2000/0; selecciones y valores
se conservan al editar. Decimales 1.5 muestran error visible. Recarga y nueva pestaña
conservan las excepciones. Evidencia: artifacts/etapa-6-2-precios.png. Sin fixtures
ni cambios QA en 5173.

Pendiente de verificación: reinicio completo del proceso del navegador y dispositivos
Android físicos; móvil se comprobó mediante viewport. Offline requiere la interfaz
previamente cargada; no se añadió service worker. No se implementaron gastos,
cierres financieros ni sincronización.

## Etapa 6.2.1 — Productos y promociones por evento

Implementación local, sin dependencias nuevas ni rediseño general.

### Formulario y costos

- Creación sin selector de tipo: un pack físico nuevo se registra como cualquier producto con precio, costo y stock propios. Los packs existentes mantienen `kind`, UUID, contenido documentado editable, existencias y comportamiento de venta.
- Orden: nombre, categoría principal, precio general/costo unitario, stock inicial/umbral, familias/IPs y detalles adicionales desplegables (descripción, imagen, destacado).
- Un solo costo al crear: vacío significa desconocido; cero es un costo conocido. Inicializa `averageCost`, `lastKnownCost` y `estimatedUnitCost` mediante el repositorio existente, con su auditoría y movimiento inicial cuando corresponde. En edición se modifica únicamente el estimado, sin reescribir promedios, último costo ni movimientos históricos.
- Errores junto a los campos iniciales; errores transaccionales visibles. Los precios por evento siguen disponibles al editar, nunca durante la creación.
- Comparación del borrador con sus valores iniciales, incluyendo imagen y selecciones. Buscar/abrir un selector no ensucia el producto. Cancelar, X, Escape o abandonar con cambios solicita descarte; sin cambios cierra directamente. Se protege también la salida del documento y la navegación entre secciones.
- Familias e IPs usan diálogos nativos en la capa superior, búsqueda, selección múltiple, etiquetas removibles y creación rápida. En móvil se presentan como panel inferior con scroll propio. Guardar/cancelar permanecen accesibles dentro del formulario.

### Promociones y reglas exactas

- Apartado propio `#promociones`, en navegación y accesible desde Organizar catálogo. Reutiliza administración y motores existentes.
- `Promotion.eventIds?: string[]`: sin valores, cualquier evento o ninguno; con valores, requiere que el UUID del evento activo esté incluido. El repositorio valida existencia y duplicados. POS y confirmación transaccional utilizan el evento vigente.
- Nuevo tipo `quantity`, con `groupQuantity` de 2 a 8 y `value` como precio CLP del grupo completo. Usa los mismos destinatarios: OR dentro de cada grupo de producto/categoría/familia/IP, AND entre grupos no vacíos. Los mínimos se evalúan sobre unidades/importes elegibles originales del carrito, antes de descuentos.
- Ejemplo: cinco stickers a $800, regla 2 por $1.000: dos grupos cuestan $2.000 y la unidad suelta $800; total $2.800. No se modifica el catálogo ni se crean productos virtuales con stock.
- Orden conservado: precio efectivo, manual individual, búsqueda exacta conjunta de grupos/combos/promociones, manual general. Las unidades de un grupo no se reutilizan en otro grupo o combo. Una promoción tradicional sobre esas unidades exige acumulación en ambas reglas. Las incompatibles compiten por el menor total final; no se aumenta el precio cuando el grupo no ofrece ahorro.
- Redondeo CLP: mitades hacia arriba, distribución proporcional por restos mayores y desempate estable por UUID. A igualdad de total se prefieren menos beneficios y luego la clave estable de reglas/unidades, igual que el motor de combos previo.
- Límites conservados: 12 reglas activas, 24 unidades elegibles para grupos/combos, 128 asignaciones por regla/estado y 20.000 pasos. Si se exceden, se muestra error y se bloquea el cobro; no se entrega una aproximación.
- Las ofertas por cantidad se guardan en `appliedCombos`, con `configuration.type = 'quantity'`, nombre, UUID, precio, aplicaciones y unidades beneficiadas. Se conservan pagos, snapshot de evento, costos y auditoría al anular.

### Compatibilidad y transición de excepciones

IndexedDB continúa en **versión 8**. No cambian almacenes ni índices: los campos opcionales caben en los registros existentes. No hay migración de costos, reescritura de productos ni conversión automática de excepciones. Los registros antiguos sin `eventIds` funcionan como antes. Las ventas históricas conservan sus copias, sin recalcularse.

Decisión de precedencia: los productos con precio especial para el evento activo mantienen esa excepción y quedan excluidos de las promociones **restringidas por evento**, incluidos grupos y combos. Esto evita duplicar el beneficio durante la convivencia. Los descuentos manuales y las promociones generales conservan la compatibilidad de la Etapa 6.2 y operan sobre el precio efectivo. La administración explica esta regla al seleccionar eventos.

Transición propuesta, no ejecutada: añadir una operación explícita de conversión desde Promociones que muestre el precio por unidad actual y el sustituto, conserve una referencia de procedencia `(productId,eventId)` y cree la regla de precio final por unidad junto con el retiro de la excepción en una única transacción. Requerirá un tipo de precio final por unidad para representar exactamente excepciones que no equivalen a porcentajes de dos decimales; no se debe aproximar un precio ni convertirlo en un descuento fijo de carrito. Los snapshots vendidos no se tocarán. Hasta implementar esa conversión, las excepciones se administran al editar productos y no se duplican automáticamente.

### Archivos de esta etapa

- Formulario: `src/components/catalog/ProductForm.tsx`, `ClassificationSelect.tsx`, `QuickClassification.tsx`, `src/components/Modal.tsx`, nuevo `src/services/productFormRules.ts`.
- Promociones: nuevo `src/screens/Promotions.tsx`, `src/components/catalog/PromotionManager.tsx`, `src/types/promotions.ts`, `src/services/promotionConditions.ts`, `promotionRules.ts`, `comboRules.ts`, `promotionRepository.ts`.
- Integración: `src/hooks/useCart.ts`, `src/services/salesRepository.ts`, `src/components/Checkout.tsx`, `SaleDetail.tsx`, `src/screens/PointOfSale.tsx`, `Inventory.tsx`, `src/utils/discounts.ts`.
- Navegación/estilos: `src/App.tsx`, `src/App.css`, `src/navigation/Navigation.tsx`, `useNavigation.ts`, `src/types/index.ts`.
- Verificación: nuevo `tests/productSimplification.test.ts`; documentación en este archivo. No se modificó `catalogDatabase.ts`.

### Verificación realizada

- `npm run build`: correcto. `npm run lint`: correcto. `npm test`: **168 pruebas correctas**, incluyendo las 159 anteriores.
- Nueve pruebas nuevas cubren grupos/remainders, intersecciones y mínimos, los cuatro tipos restringidos por evento, precedencia de excepciones, competencia con combos/manuales, límites, validación/costo único, persistencia/venta/anulación y referencias inexistentes.
- Comprobación real de interfaz en origen de QA `127.0.0.1:5174`, separado de los datos en 5173: crear y editar producto, categoría/familia/IP, creación rápida de IP conservando borrador, recarga/reapertura, cambio de costo estimado sin alterar promedio/último costo, pack existente consultado y guardado.
- Cierre sin cambios; aviso al cancelar con cambios; búsqueda en selector sin ensuciar borrador; cierre con X/Escape; intento de volver con cambios y continuación de edición; revertir el nombre permite cerrar directamente.
- Oferta activa para Feria QA Octubre creada desde administración; cinco unidades a $800 producen $2.800. Venta de QA V-000015 con $1.000 efectivo + $1.800 transferencia; historial muestra dos grupos y cuatro unidades beneficiadas. Anulación con devolución restaura stock a 10 y conserva descuento, pagos y auditoría. La anulación se completó incluso con el servidor de desarrollo detenido, con la aplicación ya cargada.
- Capturas visuales de escritorio y 390 × 844; selector en capa superior sin recorte y sin desbordamiento horizontal (ancho interno y scroll 354 px). Evidencia: `artifacts/etapa-6-2-1-producto.png` y `artifacts/etapa-6-2-1-selector.png`.
- No verificado en un Android físico ni con teclado virtual real; no se cerró el proceso completo del navegador. No se simularon grandes catálogos en la UI. La combinación exhaustiva de reglas y migraciones históricas se verificó mediante pruebas automatizadas. El arranque offline desde cero sigue dependiendo de la infraestructura PWA existente; esta etapa no añade un service worker.

## Etapa 6.3 — Refinamiento de interfaz

No cambia IndexedDB (versión 8), el motor comercial ni sus repositorios. No se añadieron dependencias. Los cambios se limitan a presentación, selección y navegación.

### Cambios

- `ClassificationSelect`: filas táctiles con `aria-pressed`, fondo rosa y borde destacado para seleccionadas, sin checkboxes. Categoría principal usa selección única; asociaciones y filtros conservan selección múltiple. Cada apertura copia las selecciones a un borrador: «Listo» confirma; X, Escape y clic exterior descartan ese borrador. Buscar no altera selecciones ni ensucia el formulario principal. «Crear» conserva las selecciones actuales antes de abrir la creación rápida. Archivos nuevos `selectionRules.ts` y `QuickClassificationDialog.tsx` reutilizan las reglas y el formulario de clasificación existentes.
- Panel inferior en móvil y diálogo compacto en escritorio; búsqueda, encabezado y barra de acciones quedan fuera de la lista que desplaza. Se adapta a `visualViewport` para reducir altura cuando cambia el espacio visible y conserva el scroll del formulario. Creación rápida disponible para Categorías, Familias e IPs en productos, Inventario, POS y administración de promociones; Productos/Eventos siguen administrándose en sus módulos respectivos.
- Promociones: lista principal con búsqueda y estado, tarjetas con tipo/valor, destinatarios/componentes y eventos. Acciones directas para detalle, editar, activar/desactivar, archivar y reactivar. Archivar exige confirmación. Nueva promoción abre un borrador vacío; editar carga solo esa promoción. `PromotionManager` ahora contiene únicamente el formulario; el guardado conserva UUID, configuración y control de concurrencia mediante el repositorio existente. `promotionPresentation.ts` centraliza etiquetas sin modificar datos.
- Formularios: pequeños ornamentos existentes en encabezados, separadores punteados, agrupaciones de campos y botones táctiles. Se mantiene el formulario de producto simplificado y los costos históricos.
- Inicio: cartel ilustrado con bienvenida y acceso principal al POS; evento activo en bloque secundario con estado, fechas, lugar y acceso a Eventos. Sin evento sigue disponible el POS. Tickets y métricas continúan usando ventas/productos reales.

### Archivos

Modificados: `src/components/catalog/ClassificationSelect.tsx`, `ProductForm.tsx`, `PromotionManager.tsx`, `src/components/Modal.tsx`, `src/screens/Home.tsx`, `Promotions.tsx`, `Inventory.tsx`, `PointOfSale.tsx`, `src/App.css`, este README.

Nuevos: `src/components/catalog/QuickClassificationDialog.tsx`, `src/services/selectionRules.ts`, `src/services/promotionPresentation.ts`, `tests/interfaceRefinement.test.ts`.

### Comprobaciones ejecutadas

- `npm run build`: correcto. `npm run lint`: correcto. `npm test`: **174 aprobadas, 0 fallos** (168 anteriores + 6 nuevas).
- Nuevas pruebas: selección/deselección y categoría única, búsqueda con selecciones previas y clasificaciones archivadas, cancelación sin mutación, creación de producto sin costo y edición posterior persistente del estimado sin cambiar historial, presentación de destinatarios/eventos y conservación de snapshots vendidos/anulados al editar/archivar promociones.
- Interfaz real en origen de QA 5174, separado del catálogo del usuario en 5173: Inicio al POS con y sin evento activo; evento de QA desactivado temporalmente y restaurado. Categoría única, familias múltiples, deselección, búsqueda, cierre sin confirmar sin advertencia falsa. Creación rápida de Familia QA 6.3 conservando nombre, precio y selecciones; producto creado sin costo, con tres familias y una IP. Después de recargar, se conservaron producto/clasificaciones y se editó estimado a $300 manteniendo promedio/último costo desconocidos.
- Detalles adicionales abiertos y descripción guardada. Edición directa de oferta por cantidad: precio, cantidad, evento y destinatario cargados; descripción editada sin cambiar beneficio. Detalle refleja el guardado. Cancelar edición sin cambios cierra directamente. Archivo cancelado y luego confirmado; reactivación devuelve a inactiva, conservando la configuración. Formulario nuevo vacío comprobado.
- Filtros del POS confirmados mediante filas, sin vaciar el carrito. Venta histórica V-000015 consultada tras editar promoción: conserva total $2.800, ahorro $1.200, cuatro unidades beneficiadas, pagos $1.000/$1.800 y auditoría de anulación.
- Tamaños **390 × 844**, **425 × 876** y escritorio **1280 × 900**. Medidas de ancho del documento coinciden con su ancho desplazable en Inicio, Inventario, Promociones y POS para ambos móviles; Inicio y POS también medidos en escritorio. Selectores móviles sin desbordamiento horizontal, cero checkboxes y encabezado/acciones dentro del panel. En selector de escritorio la lista desplazó 60 px y el encabezado/barra inferior conservaron sus posiciones.
- Consola del navegador sin errores registrados en la comprobación. Evidencia en `artifacts/etapa-6-3-inicio-390.png`, `etapa-6-3-inicio-425.png`, `etapa-6-3-inicio-escritorio.png`, `etapa-6-3-promociones-390.png`, `etapa-6-3-promociones-425.png`, `etapa-6-3-selector-390.png`, `etapa-6-3-selector-425.png`, `etapa-6-3-selector-escritorio.png`.

Limitaciones: tamaños móviles probados en navegador de escritorio; no se probó Android físico ni teclado virtual real. El código usa `visualViewport`, pero su comportamiento con un teclado móvil queda pendiente de prueba en dispositivo. No se reinició el proceso completo del navegador ni se probaron catálogos masivos en interfaz. Las seis pruebas nuevas de la suite son pruebas de reglas y persistencia; las comprobaciones visuales/interacciones se ejecutaron mediante automatización del navegador durante esta sesión, no mediante una suite DOM añadida al proyecto.

## Etapa 7.1 — Estadísticas de eventos y recursos artísticos

Implementada el 14 de octubre de 2026. Inicio conserva el cartel y botón principal
«Ir al punto de venta». Debajo muestra evento activo y seis indicadores: ingresos,
transacciones, unidades, ticket promedio, costo de ventas y utilidad bruta estimada.
Sin evento activo muestra los últimos tres eventos con ventas válidas y conserva
el acceso a Eventos y al POS. Stock bajo y últimas ventas siguen disponibles.

«Ver estadísticas» abre `#estadisticas`, sin añadir otra entrada a la navegación
principal. Se puede entrar directamente al detalle del evento activo.

- **Últimos eventos:** eventos con actividad comercial válida, ordenados por última
  venta, luego fecha de término y UUID. Una venta de total cero cuenta como actividad.
  Gráfico comparativo y tarjetas con fechas, estado e indicadores. Se muestran seis
  inicialmente y un botón carga más. Eventos históricos sin registro administrable
  se conservan con el nombre de su copia de venta y etiqueta de referencia histórica.
- **Días del evento:** selector de evento, indicadores completos, barras de ingresos,
  filas diarias desplegables con ventas, unidades, ticket promedio y utilidad.
  Días sin ventas en cero. Calendario paginado de 31 días. Las ventas fuera de las
  fechas planificadas se muestran en un bloque separado en su día real y siguen
  incluidas en el total del evento; nunca se redistribuyen entre fechas.
- **Productos más vendidos:** ranking para el evento o período elegido, ordenable
  por unidades, ingresos y utilidad; ocho barras y diez fichas inicialmente, con
  acceso a más productos. Participación en ingresos y costos incompletos visibles.
- **Generales:** resultados globales, ventas sin evento, evento específico y período
  personalizado inclusivo. Los eventos sin ventas se consultan en «Todos los eventos»;
  sus totales completos se etiquetan como independientes del filtro de período.
- Gráficos HTML/CSS dinámicos, sin librerías añadidas, valores exactos visibles y
  navegación mediante teclado. No dependen de imágenes ni de hover para leer cifras.

### Criterios y fórmulas

Solo se agregan ventas cuyo estado histórico es `completed`. Las anuladas se
conservan en Historial pero no aportan ingresos, cantidades, costos ni ranking.

| Indicador | Cálculo |
| --- | --- |
| Ingresos | Suma de `sale.total`, una vez por venta. No suma pagos ni descuentos de nuevo. |
| Transacciones | Cantidad de ventas válidas, incluidas las de total cero. |
| Unidades | Suma de cantidades vendidas, incluidas diferencias no cubiertas. Un pack físico cuenta como producto, sin expandir componentes. |
| Ticket promedio | Ingresos / transacciones; cero si no hay ventas. Presentación en CLP enteros, mitades hacia arriba. |
| Costo histórico registrado | Suma de `item.cost.unitCost × item.quantity`, exclusivamente de las copias históricas disponibles. |
| Utilidad bruta estimada | Ingresos − costo histórico, solo si todas las unidades tienen costo. Puede ser negativa. No incluye gastos. |
| Ingreso por producto | Distribución del total histórico final según `netLineTotal` (después de descuentos individuales, promociones y combos). El descuento general se reparte proporcionalmente. |
| Participación | Ingresos del producto / ingresos de la vista × 100, dos decimales con mitades hacia arriba; cero si no hay ingresos. |

Los repartos usan enteros `bigint`: cociente y restos mayores, desempate por UUID de
producto y posición de línea. La suma por productos coincide **exactamente** con
los ingresos registrados, sin recalcular el motor comercial. En recibos antiguos
sin `netLineTotal`, se usan sus propios importes originales menos los descuentos
históricos disponibles. Una inconsistencia que impida distribuir el importe se
informa en pantalla en lugar de mostrar resultados inventados.

Los productos se agrupan por UUID, incluso archivados. Se muestra el nombre de la
venta válida más reciente y se conservan los nombres históricos alternativos para
consulta. No se lee el precio, nombre ni costo actual del catálogo para los resultados.

Agrupación diaria: `America/Santiago`, independiente de la zona del equipo, con
cambios de horario. Se utiliza la fecha efectiva de venta, no la de creación del
producto, activación del evento ni registro de un pago. No se reparte una venta
entre días. Los rangos personalizados son inclusivos y un rango invertido muestra
un error; los campos reaccionan a entrada y cambio de fecha.

### Costos incompletos y provisionales

- Un costo conocido igual a cero es válido; desconocido sigue siendo desconocido.
- Con unidades sin costo, se muestra el costo **parcial** registrado, número de
  unidades sin costo y «Utilidad no disponible». No se supone un costo cero para
  completar la utilidad.
- Costos provisionales permiten una utilidad estimada señalada como **Provisional**.
- Costos estimados manualmente se contabilizan según la copia de la venta y se
  indican sus unidades. La interfaz siempre llama a la utilidad «bruta estimada».
- En el orden por utilidad, los productos sin datos suficientes van al final;
  si ninguno tiene utilidad calculable, el gráfico lo indica sin afirmar que no
  hubo ventas. Las utilidades negativas se conservan.

### Persistencia y rendimiento

IndexedDB continúa en **versión 8**. No se añaden almacenes, migraciones ni
estadísticas persistidas. `useAnalytics` deriva y memoriza resultados desde las
copias de `CatalogProvider`; no hace consultas durante cada render. Agrupación por
mapas y fechas calculadas una vez por venta, con un formateador Chile reutilizado.
Filtros y rankings se memorizan en la pantalla. Listas y calendario se presentan
progresivamente. El proveedor existente sigue leyendo sus snapshots al cargar o
recibir cambios; no se ha sustituido por un sistema de consultas incrementales.

### Archivos creados y modificados

- Nuevos: `src/services/analytics.ts`, `src/hooks/useAnalytics.ts`,
  `src/screens/Analytics.tsx`, `src/components/analytics/Statistics.tsx`,
  `src/styles/analytics.css`, `tests/analytics.test.ts`.
- Inicio/navegación: `src/screens/Home.tsx`, `src/App.tsx`, `src/types/index.ts`,
  `src/navigation/useNavigation.ts`.
- Fecha de Chile: `src/utils/format.ts` reutiliza `Intl.DateTimeFormat` con idénticas
  reglas y resultados, evitando crearlo una vez por cada venta.
- Arte: `src/assets/artisticAssets.ts`, `src/assets/manifest.json`,
  `src/assets/README.md`, `src/assets/brand/README.md`,
  `src/assets/placeholders/illustrations/circus-tent.svg`,
  `src/assets/placeholders/illustrations/product-samples.svg`;
  wrappers `src/components/CircusIllustration.tsx` y `src/components/ProductArt.tsx`.
- `README.md`: documentación de cálculo, alcance, recursos y pruebas.

No se modifican repositorios, motor de ventas/promociones, formularios operativos,
cálculo de costos, reglas de stock, esquema de base de datos ni dependencias.

### Auditoría artística

[Manifiesto](src/assets/manifest.json): **40 recursos o conjuntos**, con ID, ruta,
tipo, origen, evidencia, pantallas, componentes, formato, dimensiones, estado e
indicaciones para artistas. Distingue confirmado IA, no IA y pendiente de verificar;
no se atribuye autoría por apariencia. La fuente Fraunces conserva evidencia de
licencia/autoría local; los nuevos marcos analíticos se identifican como IA temporal.

La carpa y las seis ilustraciones legacy se extrajeron de JSX a SVG independientes;
conservan sus proporciones, colores, símbolos y wrappers. La extracción no convierte
su origen previo en «confirmado IA». Ornamentos breves, controles estándar y
tratamientos CSS permanecen centralizados y documentados. Las imágenes del catálogo
son contenido del usuario en IndexedDB, no placeholders que deban sobrescribirse.
Se conserva la marca visible Clown UFO y el nombre interno del tema Cherry Circus.

Cada futuro recurso debe agregarse al manifiesto. La entrega PDF visual + Excel
inventario queda **pendiente hasta finalizar la futura integración con Google Sheets**;
no se han generado esos documentos en esta etapa.

### Verificaciones ejecutadas

- `npm run build`: correcto (TypeScript + producción Vite).
- `npm run lint`: correcto.
- `npm test`: **191 pruebas, 191 aprobadas** (174 previas + 17 nuevas).
- Nuevas pruebas: agrupación por UUID de evento, días en cero, ventas fuera del
  programa, exclusión de anulaciones, ventas sin evento, ticket medio/redondeo,
  cantidades, packs, diferencias no cubiertas, costo conocido/cero/provisional/
  estimado/desconocido, utilidad negativa, ranking/nombres históricos, pagos
  divididos, reparto exacto de descuentos, promociones y combos, total cero,
  eventos sin ventas, cambios de día y horario chileno, fechas independientes de
  la zona del equipo, calendario extenso paginado, reapertura de IndexedDB,
  archivo y edición posteriores sin alterar ventas y rutas del manifiesto.
- Prueba de agregación de **5.000 ventas** con sumas superiores al máximo entero
  seguro de JavaScript: resultado exacto mediante bigint, sin mutaciones.
- Navegador real, **build de producción**, origen de QA `127.0.0.1:5174`, separado
  del catálogo del usuario en 5173. No se agregan datos de muestra al arranque.
- Desde el POS: venta QA V-000016 de $2.200 (dos stickers con promoción por grupo y
  un producto con costo estimado); efectivo $1.000 + transferencia $1.200. Dashboard:
  una transacción, tres unidades, costo $700 y utilidad $1.500 señalada provisional.
  Ranking: $1.000 y $1.200, sin duplicar ingresos.
- Segunda venta QA V-000017 de $1.500 en otro evento, con costo desconocido y stock
  cero. Dashboard: utilidad no disponible; diferencia no cubierta conservada.
  Al estar fuera de las fechas planificadas, aparece en el 14 de octubre, sin
  asignarse artificialmente al día 13.
- Comparación entre ambos eventos; detalle de tres días del evento Octubre:
  $0 / $2.200 / $0. Se abrió el detalle diario. Se comprobó persistencia de esas
  ventas y sus resultados después de recargar.
- Generales: filtro de ventas sin evento, período del 13 de octubre ($4.200,
  una venta), período del 14 antes de anular ($3.700, dos ventas), validación de
  rango invertido, eventos sin ventas, ranking por ingresos y por utilidad.
- Inicio sin evento activo: muestra eventos recientes y permite ir al POS.
  El evento original de QA, Feria QA Octubre, quedó restaurado como activo.
- Se anularon **ambas ventas nuevas de QA** desde Historial: quedan auditadas, con
  promociones y pagos históricos; se devolvió solo el stock descontado. Dashboard
  retiró primero el evento Precios del comparativo y luego dejó Octubre en cero.
  Inventario confirmó stock original (10 stickers, 3 productos sin costo inicial,
  0 unidades del producto con diferencia no cubierta).
- Inventario: apertura/cancelación de edición con asociaciones y costo estimado
  conservados. Promociones: apertura/cancelación directa de la regla por cantidad
  con destinatarios y evento conservados. Navegación POS/Inventario/Historial/
  Promociones/Eventos y estadísticas sin errores de consola observados.
- Viewports **390 × 844, 425 × 876 y 1280 × 900**. Se revisaron capturas de Inicio,
  comparativo, tickets, detalle diario y ranking. Mediciones de ancho: scrollWidth
  igual a clientWidth en las seis pantallas existentes y las tres vistas analíticas.
  No se observó desplazamiento horizontal en estas comprobaciones.
- Evidencia en `artifacts/etapa-7-1-eventos-{390,425,1280}.png`,
  `artifacts/etapa-7-1-inicio-{390,425,1280}.png`,
  `artifacts/etapa-7-1-ranking-{390,425,1280}.png` y
  `artifacts/etapa-7-1-dias-425.png`. Las capturas muestran el catálogo **QA** antes
  de anular las ventas de comprobación, no resultados del emprendimiento.

### Limitaciones verificables

No se probaron dispositivos físicos, teclado virtual Android, reinicio completo
del proceso del navegador ni desconexión de red en una sesión de navegador real
durante esta etapa. Las pruebas automatizadas previas con red deshabilitada sí
 siguen pasando, pero no equivalen a esa comprobación física. La app debe estar
 cargada para operar sin red; no se introduce aquí caché PWA/service worker.

La prueba de 5.000 ventas valida agregación en memoria, no un perfil completo de
rendimiento de interfaz en Android con una base grande. Cantidades/transacciones
 usan números de JavaScript; importes y costos agregados usan bigint. La atribución
 proporcional del descuento general al producto es un criterio analítico, no un
 cambio del comprobante. No se calculan gastos ni cierres financieros.

Autorías artísticas pendientes requieren confirmación de las personas responsables.
El manifiesto es el registro mantenible; el catálogo PDF y Excel definitivo sigue
pendiente de la etapa indicada. No se implementa Google Sheets ni sincronización.

## MATU ART — Ajustes posteriores a 7.1 (14-10-2026)

### Cambios y causas encontradas

- **Eventos y Promociones:** las tarjetas conservan sus colores, contenido y
  acciones. Se añadieron muescas semicirculares laterales y perforaciones punteadas;
  las acciones se distribuyen sin desbordar y tienen un área mínima de 44 × 44 px.
- **Anulación:** el repositorio ya implementaba una transacción atómica correcta,
  con bloqueo de dobles anulaciones y devolución únicamente de las unidades
  efectivamente descontadas. El botón ya existía en el encabezado, pero su formulario
  aparecía debajo de todas las líneas, pagos y promociones. Ahora la confirmación
  aparece al comienzo del detalle. Mantiene motivo obligatorio, elección de devolución
  de stock y confirmación explícita. Los pagos históricos no equivalen a reembolsos.
- **Reversiones de inventario:** no existían. Ahora se accede desde cada reposición,
  ajuste manual o conteo físico con cambio distinto de cero. Se muestra el efecto
  sobre stock y costos antes de confirmar y se exige motivo. El historial distingue
  originales revertidos y compensaciones, con UUID vinculados en ambos sentidos.
- **Archivados:** los filtros Activos/Archivados/Todos y la reactivación ya existían.
  Se añadió el contador derivado de los productos cargados, un acceso al filtro y
  un botón Reactivar más reconocible. No se elimina ni recrea ningún producto.
- **Marca:** MATU ART sustituye el nombre visible anterior en navegación, Inicio,
  encabezado, pie, mensajes de almacenamiento y título del navegador. El favicon
  utiliza el PNG oficial. El original se conserva sin recortar ni redibujar; la
  app lo escala mediante CSS. No había manifiesto PWA ni service worker que actualizar;
  no se añadió uno ni se cambió el comportamiento de instalación/offline.

### Reversiones: reglas de integridad y costos

1. Cada compensación aplica `-original.quantityChange` al **stock vigente**. Nunca
   restaura directamente un saldo antiguo, que podría ignorar operaciones posteriores.
2. Productos, movimiento compensatorio y vínculo `reversedById` del original se
   guardan en una misma transacción. Las propiedades históricas del original no
   se reescriben: únicamente se añade la referencia a su compensación.
3. El UUID de operación se conserva durante el formulario. Reintentar la misma
   petición devuelve el resultado ya guardado; otra reversión del mismo movimiento
   es rechazada. La revisión del producto impide confirmar sobre datos obsoletos.
4. No se pueden revertir movimientos `sale`, `sale_void`, `manual_reversal`, stock
   inicial ni ningún movimiento que tenga `saleId`. Las ventas se corrigen mediante
   su flujo de anulación. No se implementó reversión de una reversión.
5. Los nuevos movimientos manuales guardan `costBefore`, `costAfter` y
   `productRevisionAfter`. Si no hubo ninguna operación posterior, coinciden stock,
   revisión y costos, la compensación restaura los costos previos exactos.
6. **Decisión conservadora para movimientos antiguos o con operaciones posteriores:**
   no se puede reconstruir de forma fiable un promedio anterior. Se conservan promedio
   y último costo actuales y se marca el promedio como provisional. Esto se anuncia
   antes de confirmar y queda auditado mediante `costReversalPolicy`. El último costo
   se conserva como último valor registrado, no como una reconstrucción retroactiva.
   El costo estimado manual y los costos de ventas históricas nunca se modifican.
7. Un resultado de stock negativo está permitido conforme a la regla existente para
   operaciones manuales; el formulario lo advierte antes de confirmar. Se validan
   enteros y límites. Las ventas siguen usando sus reglas de stock existentes.
8. Se permite compensar un movimiento de un producto archivado sin reactivarlo.
   La reactivación continúa siendo una acción independiente que conserva su UUID.

### Persistencia y recursos

- IndexedDB sigue en **versión 8**, nombre interno `clown-ufo-catalog`. No se alteraron
  almacenes, índices, UUID ni identificadores de comunicación entre pestañas.
- Los nuevos datos de auditoría son campos opcionales de movimientos. Los registros
  anteriores siguen siendo legibles; no hay migración destructiva ni relleno ficticio.
- `src/assets/branding/matu-art-official.png`: archivo oficial recibido del usuario,
  4000 × 4000 px. La copia y el original tienen el mismo SHA-256:
  `8444bf5aaf6e8a805798a9d5d6fa36dda4600edf4ab0e10297ecc2177a7be94c`.
- `src/assets/manifest.json` registra el logo como oficial proporcionado por el
  usuario, `not-ai`, sin considerarlo placeholder. Las marcas anteriores se conservan
  en el inventario como retiradas. La decoración CSS nueva queda identificada como
  `confirmed-ai` y reemplazable. Los recursos de origen pendiente siguen pendientes.
- El favicon usa el archivo original completo: sus márgenes pueden reducir su
  legibilidad a tamaños pequeños. No se generó una versión recortada o redibujada.

### Archivos creados o modificados

- Reversión: `src/types/catalog.ts`, `src/services/movementReversal.ts` (nuevo),
  `src/services/catalogRepository.ts`, `src/utils/catalog.ts`,
  `src/components/catalog/ReverseMovementForm.tsx` (nuevo),
  `src/components/catalog/MovementHistory.tsx`.
- Administración: `src/components/SaleDetail.tsx`, `src/screens/Inventory.tsx`,
  `src/App.css` (tickets, áreas táctiles y presentación del logo).
- Identidad: `src/App.tsx`, `src/navigation/Navigation.tsx`, `src/screens/Home.tsx`,
  `src/hooks/CatalogProvider.tsx`, `src/services/catalogValidation.ts`, `index.html`.
- Recursos: `src/assets/artisticAssets.ts`, `src/assets/manifest.json`,
  `src/assets/README.md`, `src/assets/brand/README.md`,
  `src/assets/branding/README.md` y `src/assets/branding/matu-art-official.png` (nuevos).
- Verificación: `tests/movement-reversal.test.ts` (nuevo), capturas
  `artifacts/matu-*.png` y este `README.md`.

### Pruebas realizadas y resultados

- `npm run build`: correcto, incluyendo TypeScript.
- `npm run lint`: correcto.
- `npm test`: **199 pruebas aprobadas**, cero fallos; se conservan las 191 anteriores.
- Ocho pruebas nuevas: reposición y restauración de costos con reapertura de la base;
  ajuste negativo y conteo compensados contra stock vigente; reintentos y concurrencia;
  movimientos antiguos sin copias de costos; distinción entre costo cero y desconocido;
  rechazo de movimientos de venta/anulación y conservación de pagos/descuentos;
  compensación de archivados y reactivación persistente; validaciones y rollback
  completo ante un fallo de escritura por cuota simulado.
- Navegador integrado, compilación de producción en **127.0.0.1:5174** con el catálogo
  de QA existente, separado del origen 5173. No se insertaron fixtures en el catálogo
  del usuario. Pantallas revisadas en **390 × 844**, **425 × 876** y **1280 × 900**.
- Flujo UI: reposición de 2 unidades (3 → 5) y reversión (5 → 3), restaurando costo
  desconocido y conservando estimado $300; ajuste negativo (3 → 2) y reversión (2 → 3).
  Verificados registros originales marcados Revertido, compensaciones y filtro por tipo.
- Flujo UI: archivar producto QA, contador 1, filtro Archivados, exclusión del POS,
  reactivar desde la lista y recargar. Clasificaciones, costos y stock conservados.
- Flujo UI: venta QA V-000018 de $1.200, abrir detalle, Anular venta, motivo y
  devolución de stock, confirmar. Auditoría y pago visibles tras recarga, sin botón
  para anular nuevamente. Producto volvió a 3 unidades; la venta de QA queda anulada.
- Cierre del historial mediante X y Escape comprobado. Ningún error de consola en
  la sesión. Se verificó ausencia de desbordamiento horizontal en las tarjetas de
  Eventos/Promociones y áreas táctiles mínimas de 44 × 44 px en su versión final.
- Capturas: `matu-promociones-escritorio.png`, `matu-eventos-escritorio.png`,
  `matu-promociones-390.png`, `matu-promociones-425.png`, `matu-eventos-390.png`,
  `matu-eventos-425.png`, `matu-reversiones-390.png` (todas en `artifacts/`).

### Límites de la verificación

- Se usaron viewports de navegador, no teléfonos físicos ni teclado virtual real.
- Se comprobó persistencia mediante recarga en UI y cierre/reapertura de IndexedDB
  en pruebas automatizadas, no cerrando y reiniciando el navegador completo.
- En esta revisión no se desconectó la red físicamente ni se probó instalación PWA.
- Cuota agotada, concurrencia, costos antiguos y stock negativo de una reversión se
  verificaron con pruebas automatizadas; no se provocó falta real de espacio en el equipo.
- El cálculo de costos históricos de ventas, pagos, promociones, descuentos, combos
  y anulación transaccional no se modificó. Su cobertura anterior sigue pasando.

## Etapa 7.2 — Gastos, rentabilidad e identidad (14-10-2026)

### Administración y auditoría

- Acceso a **Gastos** desde Eventos, cada tarjeta de evento y Estadísticas. El acceso
  contextual preselecciona el evento; desde Generales respeta el ámbito seleccionado.
- Gastos con UUID estable, concepto, importe entero positivo en CLP, categoría,
  fecha calendario, evento opcional, notas, estado, creación, modificación y revisión.
- Crear, editar y anular. Los anulados permanecen consultables; no se pueden editar
  ni anular nuevamente. La anulación exige motivo y confirmación.
- Cada operación conserva una copia completa anterior/posterior y un UUID de operación.
  Gasto y auditoría se escriben atómicamente. Reintentos idénticos son idempotentes;
  reutilizar un UUID con otra petición produce un error.
- Revisión optimista y transacciones de escritura serializadas protegen cambios entre
  pestañas. El aviso entre pestañas y refresco reutilizan `useStorageAction` y el proveedor
  existente. Ante conflicto, cerrar y reabrir el formulario antes de corregir.
- Categorías iniciales: inscripción, transporte, alojamiento, alimentación, materiales,
  publicidad y otros. Son configuración, no gastos ficticios. Se pueden crear categorías
  desde el botón + sin perder el formulario. Sus nombres son únicos normalizados.
- Importe permitido: entero entre 1 y 1.000.000.000 CLP, conforme al límite de validación
  existente. Las fechas se validan como días de calendario reales; pueden diferir de
  las fechas planificadas del evento. Las notas admiten 2.000 caracteres.
- Errores junto a campos, teclado numérico, botones accesibles, scroll interno y
  confirmación al intentar descartar un formulario modificado. Un formulario intacto
  se cierra directamente. El éxito se muestra después del commit.

### Fórmulas y alcance financiero

Los cálculos reutilizan copias históricas; no consultan precios/costos del catálogo
ni vuelven a ejecutar promociones, combos o descuentos.

- **Ingresos:** suma del `total` final de ventas `completed`. Los pagos divididos no
  se suman como ventas separadas. Los descuentos ya están incluidos en ese total.
- **Transacciones:** número de ventas válidas. **Unidades:** cantidades históricas,
  incluyendo packs como productos con stock independiente.
- **Ticket promedio:** ingresos / transacciones, redondeado al peso; mitades hacia arriba.
- **Costo de ventas:** suma de cantidad × costo unitario histórico conocido. Si falta
  algún costo, se identifica como parcial y no se calcula utilidad ni margen.
- **Utilidad bruta estimada:** ingresos − costo histórico de productos vendidos.
- **Gastos:** suma de importes de gastos activos del ámbito y período seleccionados.
- **Utilidad neta estimada:** utilidad bruta − gastos activos del contexto.
- **Margen neto:** utilidad neta / ingresos × 100, hasta dos decimales, redondeando
  mitades hacia fuera de cero. Si los ingresos son cero o faltan costos, no disponible.
  Las utilidades negativas siguen siendo válidas y visibles.
- Los importes agregados utilizan BigInt. El margen es un porcentaje de presentación.
- Los costos estimados y provisionales conservan su condición explícita. Desconocido
  nunca se convierte en cero. Sin ventas, el costo de ventas es cero: los gastos pueden
  producir una utilidad neta negativa, pero no un margen cuando no hay ingresos.
- **Por evento:** solo sus ventas y sus gastos por UUID. **Generales:** resultados de
  todos los eventos más ventas sin evento y gastos globales. **Sin evento:** solo
  ventas sin evento y gastos globales. Nunca se distribuyen gastos globales entre ferias.
- Períodos inclusivos: fecha local `America/Santiago` de las ventas y fecha calendario
  introducida en el gasto. Los gastos no se desplazan por conversión UTC.
- Días del evento: cada día refleja sus propios registros. Los gastos y ventas fuera
  de las fechas planificadas aparecen aparte y se incluyen en el total del evento.
  No se reparten importes artificialmente; el calendario mantiene paginación de 31 días.
- Comparación por ingresos, gastos, utilidad neta, unidades, ticket promedio y margen.
  Los eventos con solo gastos también aparecen; todos siguen consultables en Generales.
  Los valores no calculables se omiten del gráfico y se explican en las tarjetas.
- Estos indicadores son estimaciones de rentabilidad, **no flujo de caja**. Un gasto
  anulado no implica un reembolso, igual que una venta anulada conserva sus pagos.
- Los gastos de materiales se tratan como gastos ingresados por el usuario. Si un mismo
  desembolso ya está incorporado en el costo unitario histórico, registrarlo además como
  gasto operativo puede duplicar su efecto económico. No se implementó contabilidad de
  compras/capitalización ni deduplicación automática entre costos y gastos.

### Migración y compatibilidad

IndexedDB pasa de **v8 a v9**, con el mismo nombre interno `clown-ufo-catalog`.
El bloque `oldVersion < 9` añade exclusivamente:

| Almacén | Clave / índices | Uso |
| --- | --- | --- |
| `expenses` | `id`; `by-event`, `by-date` | Estado vigente de cada gasto |
| `expenseChanges` | `id` de operación; `by-expense` | Creaciones, ediciones, anulaciones y copias históricas |
| `expenseCategories` | `id`; `by-name` único | Categorías configurables |

La migración crea las siete categorías iniciales con UUID fijos y estables; no inserta
ningún gasto de ejemplo. Es atómica e idempotente al reabrir. No reescribe productos,
UUID, imágenes, ventas, pagos, clasificaciones, promociones, costos ni movimientos.
Las funciones analíticas son puras, memoizadas a partir del snapshot del proveedor;
no se almacenan estadísticas duplicadas ni se consulta IndexedDB en cada render.

### Refinamiento visual y recursos oficiales

- Muescas transparentes con máscaras CSS en Eventos, Promociones, tickets estadísticos,
  tarjetas comparativas y bienvenida de Inicio. Se eliminan los círculos con contorno;
  permanecen el marco exterior y separadores punteados.
- Adorno del talón centrado independientemente de la altura del contenido; «RESUMEN»
  y «N.º XX» cerca de los extremos. Se conservan colores y jerarquía del diseño existente.
- Inicio muestra literalmente «Evento activo». El POS sigue siendo la acción principal.
  Últimas ventas separa mejor importe, productos, fecha, medios de pago, evento y estado.
- Logo oficial con fondo circular rosa. `clown icon.png` se copió sin modificar a
  `src/assets/branding/clown-icon.png`: SHA-256 idéntico al original.
- El payaso reemplaza las variantes decorativas rosette/starburst: navegación de marca,
  Eventos, Promociones e imágenes ausentes de productos. Los controles funcionales
  y sus iconos mantienen su significado y comportamiento.
- `src/assets/manifest.json` distingue los PNG oficiales proporcionados por el usuario
  de la decoración CSS provisional y de los recursos de origen pendiente. No se generaron
  ilustraciones mediante IA ni la documentación final PDF/Excel.

### Archivos de esta etapa

- Nuevos: `src/types/expenses.ts`, `src/services/expenseRules.ts`,
  `src/services/expenseRepository.ts`, `src/components/expenses/ExpenseForm.tsx`,
  `ExpenseDetail.tsx`, `ExpenseManager.tsx`, `src/styles/expenses.css`,
  `src/assets/branding/clown-icon.png`, `tests/expenses.test.ts`.
- Persistencia y estado: `src/services/catalogDatabase.ts`,
  `src/hooks/catalogContext.ts`, `CatalogProvider.tsx`, `useAnalytics.ts`.
- Cálculos y presentación: `src/services/analytics.ts`, `src/utils/format.ts`,
  `src/components/analytics/Statistics.tsx`, `src/screens/Analytics.tsx`,
  `Events.tsx`, `Home.tsx`, `src/components/StoredSaleList.tsx`, `Ornament.tsx`,
  `src/App.css`, `src/styles/analytics.css`.
- Recursos/documentación: `src/assets/artisticAssets.ts`, `src/assets/manifest.json`,
  `src/assets/branding/README.md`, `src/assets/README.md`, este README y capturas
  `artifacts/etapa-7-2-*.png`.
- Pruebas anteriores: expectativas de versión en analytics, classification45, combos,
  eventPrices, events, movement-reversal y productSimplification. Los fixtures de
  migración v6/v7 excluyen los almacenes posteriores a su versión; conservan sus
  comprobaciones de integridad anteriores.

### Validación ejecutada

- `npm run build`: correcto (TypeScript + Vite).
- `npm run lint`: correcto, sin advertencias en la ejecución final.
- `npm test`: **212 aprobadas, cero fallos**; 199 anteriores y 13 nuevas.
- Automatizadas nuevas: CRUD y auditoría de gastos, asociación opcional, validación
  CLP/fechas, reintentos, conflictos concurrentes, categorías únicas, rollback por
  cuota, comparación de eventos, gastos globales/anulados, costos desconocidos,
  provisionales y estimados, pagos divididos y descuentos históricos, días de Chile,
  gastos fuera de fechas, márgenes negativos/ingresos cero y migración v8→v9 con
  conservación de todos los almacenes anteriores, rollback y reapertura idempotente.
- Navegador integrado con compilación de producción en **127.0.0.1:5174**, catálogo
  separado del origen del usuario 5173. No se introdujeron datos de prueba en 5173.
- UI a **390 × 844** y **425 × 876**: validación del gasto vacío, creación rápida de
  categoría, conservación del borrador, aviso al cerrar con cambios, cierre directo
  sin cambios, creación de gasto por evento, edición y gasto global.
- Recarga: los dos gastos mantuvieron importes, asociaciones y notas. La auditoría
  mostró creación ($150), edición ($200), anulación y sus copias. Ambos anulados
  continuaron disponibles tras recargar y quedaron fuera de los totales vigentes.
- UI financiera: venta QA V-000019 con efectivo $400 + débito $400. Ingresos $800,
  costo histórico provisional $200, gasto del evento $200, utilidad neta $400 y margen
  50 %. El gasto global $50 apareció solo en el ámbito correspondiente, sin sumarse
  a los gastos del evento.
- UI con costo desconocido: V-000020 elevó ingresos del evento a $2.300; costo parcial
  $200 y gastos $200 continuaron visibles, utilidad bruta/neta y margen no disponibles.
- Ambas ventas de QA se anularon con devolución del stock efectivamente descontado;
  ambos gastos de QA se anularon con motivo. Los indicadores vigentes del evento
  quedaron en cero y su margen no disponible. Los registros auditados se conservan.
- Visuales en **1280 × 900**, 390 y 425 px: tickets, logo circular, icono del payaso,
  formularios, estadísticas y controles. En 390 px se midieron los nueve talones:
  diferencia de centro vertical del adorno = 0 px. No hubo desbordamiento horizontal
  en las vistas revisadas.
- Comprobación final a 425 px: Últimas ventas distingue evento, estado, pago e importe;
  el formulario de gastos cabe sin desplazamiento horizontal. La consola del navegador
  de QA no registró errores. Inventario mostró de nuevo 10 unidades de Sticker QA 6.2.1
  y cero de Producto QA jerarquía después de las anulaciones.

### Límites y decisiones pendientes

- No se probaron teléfonos físicos ni teclado virtual real; se usaron viewports del
  navegador integrado. No se verificó Safari ni otros motores de navegador.
- La persistencia se comprobó con recargas de UI y reapertura de conexiones IndexedDB
  en pruebas. No se cerró y reinició el navegador completo.
- No se desconectó físicamente la red en esta etapa. El repositorio no utiliza servicios
  de red, pero esto no acredita instalación PWA ni recarga offline desde cero.
- Concurrencia, falta de cuota, fallo de migración y casos financieros extremos se
  probaron automáticamente, no provocando condiciones reales en el equipo del usuario.
- Crear categorías está disponible; no se añadió un administrador completo para
  renombrarlas/archivarlas. No hay impuestos, caja, amortización, reembolsos ni Sheets.
- El servidor de QA inicialmente no pudo iniciarse porque la revisión automática de
  permisos agotó su límite de uso. Tras la indicación de continuar, la revisión se
  completó y se ejecutaron las verificaciones de navegador descritas arriba.

## Etapa 7.3 — Exportaciones, informes y respaldos

### Uso y alcance

- **Inventario → Datos y respaldos** reúne exportaciones CSV (un ZIP con una tabla
  por entidad), Excel y respaldo JSON completo. Se genera primero el archivo y luego
  se ofrece Descargar o Compartir, si el navegador admite compartir archivos.
- Filtros independientes: evento, fechas de ventas en Chile, productos activos/
  archivados y movimientos por producto/fechas. No recortan gastos mediante el período
  de ventas. Se conservan los registros relacionados necesarios y se identifican
  como referencias, sin incluirlos nuevamente en ingresos filtrados.
- **Exportar informe PDF** está en Estadísticas → Días del evento y en el detalle
  de Eventos. Incluye el logo oficial, indicadores, ranking, descuentos, pagos y gastos.
- Generación, validación y restauración usan Workers para mantener disponible la UI.
  Se bloquea el doble envío y el cierre durante una operación. Los errores se muestran
  sin anunciar éxito antes de concluir la operación.
- No cambia el motor comercial, UUID, precios, stock, costos, pagos ni anulaciones.
  **IndexedDB conserva la versión 9; no hay migración estructural.** No hay Sheets.

### Formatos e integridad

CSV: UTF-8 con BOM, separador punto y coma, comillas escapadas, saltos CRLF y protección
contra interpretación de fórmulas en celdas de texto. Excel: hojas por entidad, UUID
como texto, fechas y CLP con formato, encabezados congelados y filtros; sin fórmulas.
Las fechas con hora se identifican como UTC; las fechas de negocio conservan su día.
Ambos exportan el snapshot persistido de IndexedDB, no los resultados visibles en UI.
Las ventas anuladas siguen identificadas y las copias comerciales históricas no se
recalculan con el catálogo actual. Pagos y descuentos tienen tablas propias; los
pagos divididos no se vuelven a sumar como ingresos.

El PDF reutiliza `buildAnalytics`, `rankProducts` y los resultados históricos:
ingresos válidos menos costos históricos = utilidad bruta; menos gastos activos del
evento = utilidad neta. No reparte gastos globales. Costos desconocidos producen
**No disponible** en utilidades y margen; los estimados/provisionales se identifican.
Ventas y gastos anulados se excluyen del resultado comercial, no de los respaldos.

El respaldo tiene **formato 1**, versión de esquema origen, fecha, cantidades por
almacén, datos y SHA-256. Incluye los 15 almacenes, imágenes Blob en Base64 recuperable,
clasificaciones, precios por evento, costos, ventas, pagos, anulaciones, promociones,
combos, eventos, gastos, auditorías y configuración persistente. No incluye carrito
temporal ni caché de recursos. El hash detecta corrupción, no es firma ni cifrado.
Esquema y evolución: [docs/backup-format.md](docs/backup-format.md).

### Restauración de reemplazo completo

1. Guardar un respaldo actual y cerrar otras pestañas de MATU ART.
2. Seleccionar el JSON. Se verifican versión, hash, tipos, imágenes, UUID, referencias,
   importes y auditorías; se muestran cantidades locales y entrantes.
3. Escribir `RESTAURAR` y pulsar **Reemplazar datos locales**.
4. Se comprueba que la base no cambió desde la vista previa y que no existan almacenes
   o metadatos desconocidos que puedan representar operaciones pendientes.
5. Borrado, inserción y comprobación se ejecutan en **una transacción para todos los
   almacenes**. Un fallo revierte también el borrado; no queda una restauración parcial.
6. Después del commit se recarga la aplicación y se descarta el carrito temporal.

No mezcla bases. Se rechazan versiones incompatibles hasta implementar un adaptador
explícito y probado; el formato no presupone que IndexedDB siempre permanecerá en v9.
Límites: JSON 128 MB/250.000 registros, imágenes acumuladas 64 MB al generar y hasta
10 MB por imagen importada; Excel 200.000 filas por hoja/32.767 caracteres por celda.
Se informa el límite sin truncar registros. CSV/JSON conservan textos largos.

### Recursos sin conexión

La compilación de producción incluye un Service Worker con precaché de HTML, JS,
CSS, fuentes, ilustraciones y Workers. Los exportadores se empaquetan autocontenidos
para no solicitar módulos adicionales al comenzar una exportación offline. La caché
omite duplicados y sirve los recursos públicos pese al encabezado `Vary: Origin`
del servidor de desarrollo/preview. No almacena datos comerciales en Cache Storage.
Se muestra el estado de preparación; una actualización pendiente pide cerrar las
pestañas para activarse. Requiere una primera carga con conexión y espacio disponible.
La caché de producción no se instala desde `npm run dev`.

### Correcciones visuales

- `TicketFrame` dibuja un único contorno SVG cerrado, medido con ResizeObserver:
  muescas arriba/abajo en Eventos y laterales en Promociones y Resultados. Mantiene
  grosor uniforme, esquinas redondeadas y separadores punteados, sin parches de fondo.
- El bloque título/valor/descripción y el adorno del talón quedan centrados. Alturas
  uniformes por fila; altura adaptable y sin recorte de «No disponible» en móvil.
- El payaso se centra usando los límites alfa reales del PNG. El original oficial
  permanece intacto; no se introdujo el icono antiguo de estrella con pinchos.
- El carrito tenía un pseudoelemento inferior que prolongaba y superponía su borde.
  Se eliminó esa solapa y se usa un solo borde redondeado; se conserva la franja superior.
  Los estilos finales se cargan después de App.css para evitar que la regla anterior
  reaparezca por orden de cascada.
- El manifiesto registra el contorno generado como decoración reemplazable y conserva
  la procedencia oficial del logo/payaso. No se generó el catálogo artístico definitivo.

### Archivos creados y modificados

- Datos: `src/services/data/{snapshot,backupValidation,backup,exportTables,fileFormats,
  eventPDF,download,files.worker,restore.worker}.ts`.
- UI: `src/components/data/{DataManager,ReportButton}.tsx`,
  `src/screens/{Inventory,Events,Analytics,Promotions}.tsx`,
  `src/components/analytics/Statistics.tsx`, `src/styles/data.css`.
- Contornos: `src/components/TicketFrame.tsx`, `src/services/ticketGeometry.ts`,
  `src/styles/tickets.css`, `src/App.tsx` y `src/assets/{manifest.json,README.md}`.
- Offline: `offlinePlugin.ts`, `vite.config.ts`, `src/services/offlineStatus.ts`,
  `src/main.tsx`. Dependencias: `package.json`/`package-lock.json` (ExcelJS, jsPDF,
  AutoTable, fflate, Zod; override de uuid de ExcelJS).
- Pruebas: `tests/data.test.ts`, `tests/offline.test.ts`; documentación:
  `docs/backup-format.md`, este README. Evidencia en `artifacts/etapa-7-3-*`.

### Validación ejecutada

- `npm run build`: correcto. `npm run lint`: correcto.
- `npm test`: **230 aprobadas, cero fallos** (212 anteriores y 18 nuevas).
- Respaldos: comparación completa antes/después, bytes de imágenes, UUID, relaciones,
  métricas financieras, reapertura de IndexedDB, reemplazo sin mezcla ni duplicación,
  JSON corrupto, hash/versiones inválidas, referencias faltantes, pagos/auditorías
  inconsistentes, concurrencia y bloqueo ante metadatos pendientes desconocidos.
- Fallo de cuota inyectado a mitad de transacción: rollback íntegro, incluidos los
  vaciados. Venta de total cero y anulación después de restaurar: stock, pagos,
  contador y auditoría conservados. La batería comercial anterior sigue aprobada.
- Exportaciones vacías, archivados, múltiples eventos, anulaciones, pagos divididos,
  costos desconocidos/provisionales/estimados, gastos globales/de evento, descuentos,
  promociones y combos históricos. XLSX y ZIP generados y reabiertos por biblioteca.
- PDF generado con logo oficial: sus dos páginas se renderizaron e inspeccionaron;
  tablas y secciones legibles, sin filas cortadas ni textos superpuestos.
- Navegador integrado de QA **127.0.0.1:5174**, separado del origen del usuario 5173:
  generación de JSON/Excel/CSV, descarga de JSON y PDF disponible desde Eventos y
  Estadísticas. No se modificaron datos comerciales en esta revisión de UI.
- Comprobación visual en **390 × 844, 425 × 876 y escritorio 1280 × 900**: contornos,
  controles y desplazamiento de Datos y respaldos, Eventos, Promociones, Resultados,
  Inventario y carrito. Sin desbordamiento horizontal en las vistas medidas.
  Centro del contenido de Resultados: desviación 0 px. Payaso: desviación inferior
  a 0,01 px respecto al centro del contenedor, usando sus límites alfa.
- Carrito temporal con una y dos unidades: borde continuo; la promoción por dos
  unidades siguió aplicada. Se quitaron esas unidades al terminar, sin guardar ventas.
- **Servidor de QA detenido:** tras corregir la coincidencia de caché `Vary: Origin`,
  recarga de la aplicación y generación de JSON, XLSX, CSV y PDF completadas desde UI.
  Pruebas automatizadas adicionales bloquean red durante respaldo/exportación/
  restauración y verifican la resolución de módulos precargados y navegación offline.

### Limitaciones y comprobaciones pendientes

- La selección de JSON en el navegador fue rechazada por la política de permisos del
  entorno. No se intentó eludirla. **Vista previa, confirmación y restauración mediante
  UI quedan pendientes de comprobación manual**; su capa de datos y rollback sí se
  ejecutaron en pruebas automatizadas con IndexedDB aislado.
- No se probaron Android físico, teclado virtual real, compartir con otra aplicación,
  Excel/LibreOffice de escritorio ni desconexión física de la red. La prueba offline
  consistió en detener el servidor de la aplicación, no en desactivar Wi-Fi.
- Se recargó y se cerró/reabrió la pestaña, pero no se reinició el navegador completo.
  Los fallos de cuota se simularon; no se agotó el disco del usuario.
- Un navegador puede descartar su almacenamiento. Los respaldos descargados deben
  conservarse fuera de la base local; la aplicación no tiene copia en la nube.


## Etapa 8.1: infraestructura segura, sin sincronización

Arquitectura: MATU ART (IndexedDB v9) → Cloudflare Worker + D1 → Apps Script →
Google Sheets. Implementación local completa para el alcance de conexión; sin
recursos remotos desplegados ni secretos reales. La operación local continúa igual.

- Autenticación propia sin Google Login; scrypt con sal, sesiones opacas de 8 horas,
  cookies HttpOnly/Secure/SameSite=Strict, CSRF, límites persistentes y permisos
  servidor para Administrador/Encargado/Vendedor. Bootstrap sin registro público.
- Apps Script solo lectura: HMAC en cuerpo, timestamp y nonce persistente bajo lock.
  Rechazo de anónimos/replays; no escrituras ni sincronización de ventas/productos.
- Inventario → Conexión a la nube: login, sesión, logout, prueba autenticada de Sheets,
  estado local y errores de red. Ningún token se guarda en localStorage/IndexedDB.
- Producción requiere /api en el mismo origen HTTPS. No hay migración IndexedDB;
  la migración SQL 0001 crea una base D1 independiente de cuentas/sesiones/límites.
- Contrato de operaciones futuras, UUID/revisión/ACK/conflictos, sin activar outbox.
  Esquema Sheets documentado, sin importar datos ni recalcular históricos.

### Archivos

- Nuevos: `backend/package.json`, lockfile, `tsconfig.json`, `wrangler.jsonc`,
  `.dev.vars.example`, `.gitignore`, `migrations/0001_auth.sql`,
  `src/{index,security,gateway,types}.ts`, `scripts/bootstrap.ts`.
- Nuevos: `apps-script/{Code.gs,appsscript.json}`, `.env.example`,
  `src/services/cloud/{client,contracts}.ts`, `src/components/cloud/CloudConnection.tsx`,
  `tests/cloud.test.ts`, `docs/{cloud-8.1,sheets-schema}.md`.
- Modificados: `.gitignore`, `src/screens/Inventory.tsx` (solo acceso al panel),
  `offlinePlugin.ts` (exclusión /api), `tests/offline.test.ts`, README y PROJECT_CONTEXT.
  Logo y manifiesto artístico intactos; no recursos gráficos nuevos.

### Verificación real

- `npm run build`, `npm run lint`: correctos.
- `npm test`: **240 aprobadas, 0 fallos**. Log `artifacts/etapa-8-1-tests.txt`.
- `backend/npm run check` y `wrangler deploy --dry-run`: correctos; no deploy remoto.
- Credenciales correctas/incorrectas, expiración, logout, roles, cuentas desactivadas,
  CSRF/orígenes, datos malformados, límites concurrentes, replay/firma Apps Script,
  fallos de red y redirecciones de gateway. Apps Script usa sus funciones reales
  ejecutadas en VM **con servicios Google simulados**.
- SQLite local reabierto conserva sesiones. Además workerd+Wrangler/D1 local real:
  migración, login scrypt, detener/reiniciar Worker, consultar misma sesión y revocar
  mediante logout. No equivale a haber probado D1 remoto.
- Conservación de snapshot IndexedDB tras login/logout y venta offline con fetch
  bloqueado, reabriendo DB v9. Batería existente de ventas/anulaciones conserva éxito.
- UI aislada localhost:5176: login, consulta por cookie, logout, error de gateway
  sin configuración; backend detenido genera mensaje de red sin bloquear Inventario.
  Revisión móvil 390×844/425×876 y escritorio. Sin desbordamiento móvil medido.
- Bundle frontend revisado para excluir código/identificadores de secretos servidor.
  No se recibieron ni configuraron credenciales reales.

### Pendientes externos y límites

Seguir [guía de despliegue](docs/cloud-8.1.md): Cloudflare/dominio, D1, secreto servidor,
proyecto Apps Script, hoja privada, admin real, VITE_CLOUD_API_URL y prueba E2E.
No compartir secretos en el chat ni en el repositorio. El hashing requiere capacidad
CPU superior al límite de Workers Free; dimensionar y medir en producción.
No se probaron Google Sheets real, cookies sobre dominio productivo, Android físico,
teclado virtual ni pérdida física de red. La verificación de venta offline de esta
etapa fue automatizada; no se registraron ventas manuales en datos del usuario.
Persisten las limitaciones de restauración UI de 7.3. No MFA/recuperación/gestión de
cuentas ni sincronización aún. Preparación de 8.2 documentada, no implementada.


## Etapa 8.1.1 — importación local controlada (2026-10-20)

Implementados lector CSV/TSV, vista previa, correspondencias revisables, respaldo
previo opcional, confirmación explícita e inserción atómica con procedencia durable.
IndexedDB **v10** añade `importRecords`; conserva los datos anteriores y admite
respaldos v9 mediante adaptador. Stock nuevo pendiente de conteo; ventas históricas
sin efectos sobre stock ni costos inventados. No se inició sincronización.

Datos reales analizados: 77 productos, 5 familias, 40 IPs normalizadas; 150 filas de
ventas ($192.400). Con decisiones confirmadas por el usuario, 147 filas ($184.400)
resueltas y 3 ($8.000) pendientes. **No se aplicó la importación a la base del usuario.**

Build/lint correctos y 253 pruebas aprobadas (13 de importación), sin omitidas.
Comprobación visual de esta etapa pendiente: herramienta CUA falló al inicializarse.
No afirmar Android físico, cierre/reapertura manual ni Google Sheets real verificados.

Procedimiento, archivos, reglas, recuperación y límites: [guía 8.1.1](docs/import-8.1.1.md).
Las secciones anteriores conservan el estado histórico de cada etapa.

## Etapa 8.2 — preparación de GitHub Pages, 21-10-2026

Configuración `MATU_BASE_PATH`, workflow manual `.github/workflows/pages.yml`,
manifiesto PWA y cachés aisladas por scope. Conexión bajo Datos y respaldos.
Contrato de catálogo y módulos Worker/D1 preparatorios, sin endpoints nuevos
habilitados ni migraciones aplicadas. Apps Script sigue en v1 de lectura.

Build raíz y subcarpeta, lint, check backend y 258 pruebas correctos. Verificación
visual local de escritorio/390/425 px y recarga desde caché con servidor detenido.
No se publicó GitHub Pages ni se contrató Workers Paid; Wrangler no autenticado.
No se crearon recursos remotos ni se enviaron registros comerciales. La Etapa 8.2
permanece pendiente. Detalle, archivos y límites en docs/cloud-8.2.md.

## GitHub Pages — preparación local, 23-10-2026

Decisión confirmada: Pages primero, nube pendiente. `npm run build:pages` requiere
MATU_BASE_PATH (`/repositorio/` o `/`), compila sin API cloud y verifica manifiesto,
rutas y recursos precacheados. Workflow manual preparado, no ejecutado. Fuentes
comerciales, respaldos y artifacts excluidos de Git sin borrar los originales.
La URL del repositorio todavía debe definirse. Ver docs/github-pages.md.

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

## Ampliación local 8.2 — 27-10-2026

Implementados Crear nuevo, administración con formularios separados, eliminación
controlada y reasignación de categorías; XLSX y plantillas CSV/XLSX en importación.
Detalle de archivos, reglas, pruebas y límites: [Administración local 8.2](docs/catalog-administration-8.2.md).
IndexedDB sigue v10; no se borraron datos del usuario. Build/lint correctos, 270
pruebas aprobadas. Revisión de escritorio, 390×844 y 425×876; sin Android físico.
La nube queda pendiente por confirmación expresa del usuario: conservar Worker/D1,
Apps Script y Sheets; retomar configuración externa después, sin pagos autorizados.
No hay tombstones ni sincronización activada. Cambios locales aún no publicados en Pages.
