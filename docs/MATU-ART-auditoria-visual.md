# MATU ART — Inventario visual para ilustración

Auditoría del 13 de noviembre de 2026. Código de referencia: commit `527f9f3`.
Esta entrega es exclusivamente documental: no se reemplazaron, modificaron ni
eliminaron recursos gráficos ni código de la aplicación.

## Entrega

- `MATU-ART-inventario-iconos.xlsx`: 54 recursos maestros con 54 miniaturas incrustadas,
  las 15 columnas solicitadas y dos adicionales (categoría y uso operativo).
- `MATU-ART-referencias/`: 54 PNG de referencia identificados por ID, SVG extraídos
  para consulta, copias de originales pertinentes e `index.html` con galería visual.
- `MATU-ART-referencias.zip`: misma carpeta para entregar al artista.
- Hoja **Usos**: 260 ubicaciones estáticas, con archivo, línea y columna.
- Hoja **Guía y pendientes**: criterios, entrega recomendada, límites y procedencia.

## Resumen

**54 recursos únicos: 37 activos y 17 sin uso visible.** De los activos, 26 son
iconos/dibujos/decoraciones propios del proyecto (incluidos los dos recursos oficiales);
4 son glifos funcionales, 6 controles del navegador y 1 gráfico de datos. No todos
requieren un encargo artístico. Los 17 sin uso se mantienen claramente marcados.

| Categoría del maestro | Recursos |
|---|---:|
| Identidad visual y decoraciones | 7 |
| Navegación | 6 |
| Acciones y controles | 15 |
| Productos e inventario | 1 |
| Eventos | 1 |
| Historial y estadísticas | 5 |
| Estados y mensajes | 1 |
| Ilustraciones grandes | 1 |
| No utilizado | 17 |

No se duplican maestros para llenar categorías: los iconos de acciones se reutilizan
en POS, formularios, configuración, pagos y estados. Sus destinos están en **Usos**.
Las 260 ubicaciones no significan 260 pantallas ni 260 instancias simultáneas.
Una llamada dentro de un listado puede producir tantos dibujos como registros existan.
Se expandieron los wrappers Modal, SearchField, EmptyState, ProductImage y tarjetas
analíticas a sus ubicaciones de llamada. Los detalles específicos se conservan por línea.

## Método y cobertura

Se siguió el árbol de imports desde `src/main.tsx`, incluidas cargas lazy: 142 módulos
alcanzables. Se revisaron src/components, src/screens (no existe src/pages), src/assets,
public, TSX/TS/CSS/SVG, index.html, offlinePlugin.ts y el informe PDF por evento.
Se inspeccionaron todas las familias de SVG inline (Icon, Ornament, TicketFrame),
recursos externos, pseudoelementos CSS, símbolos tipográficos de controles y controles
nativos. Archivos de dependencias, builds y artefactos de pruebas no son recursos UI.

Componentes sin conexión al árbol operativo: ProductArt, SaleList, CategoryManager y
LegacyCloudConnection. Sus gráficos no cuentan como usos actuales. Las seis muestras
de producto y seis símbolos sociales de plantilla están catalogados individualmente.
`public/icons.svg` y `public/favicon.svg` todavía se precargan por el service worker,
pero no se muestran como iconos activos. No se borró ningún archivo.

No se encontró una biblioteca activa de iconos. Los once iconos operativos son paths
locales de Icon.tsx. El SVG React antiguo declara clase Iconify/logos: se documentó,
sin atribuir autoría no comprobada ni tratarlo como recurso artístico de MATU ART.

## Dimensiones y referencias

Las medidas de archivo, CSS px, viewBox y restricciones responsive están separadas.
Los tickets dependen de ResizeObserver y del contenido; sus capturas utilizan una
caja de referencia 280 × 180, no una medida fija de producción. El viewBox dinámico
no se reemplaza por ese ejemplo. Las referencias generales usan 320 × 220 CSS px,
renderizadas a 2×: ese lienzo no es una exigencia de entrega para el artista.

SVG y CSS se renderizaron en un navegador Edge headless aislado con los estilos
originales. No se cargó la app ni se conectó a Firebase/IndexedDB para tomar referencias.
Los controles nativos son ejemplos reales de Edge; no se afirma que Android use
el mismo dibujo. Búsqueda y número se capturaron con foco/hover para mostrar sus iconos.

Los componentes rosette y starburst actuales comparten el mismo payaso: MAR-002.
La carpa ILU-001 incluye sus pequeñas banderas, estrellas, destellos y suelo; no se
cuentan nuevamente como recursos independientes. Las estrellas independientes sí
figuran como maestros. Las muescas antiguas anuladas por CSS no se presentan como
activas. No se confunden fuentes, colores, sombras y bordes simples con ilustraciones.

## Pendientes y elementos que no se pueden medir desde el repositorio

1. **Imágenes particulares de productos**: están en blobs de IndexedDB; no están en el
   código. No se exportaron datos privados ni se inventaron miniaturas o dimensiones.
   ProductImage usa contain, contenedor pequeño 44 × 44 y catálogo adaptable.
2. **Arte de controles Android / iconos del sistema**: tamaño y aspecto dependen del
   navegador, SO y zoom; por ejemplo el indicador de contraseña puede variar. No se
   inventarió arte del sistema que el código no define ni se verificó físicamente.
3. **Autoría de iconos SVG, carpa y ornamentos antiguos**: Origen desconocido. La
   geometría TicketFrame tiene creación por Codex documentada en el manifiesto;
   esa evidencia no se extrapola a otras ilustraciones.
4. **Cantidad de instancias y dimensiones de contenedores**: dependen de datos,
   viewport y contenido. Se documentan reglas y ubicaciones; no cifras runtime ficticias.

El logo y el payaso oficiales tienen evidencia de entrega por el usuario en el README
branding y manifiesto existentes. Se conservaron originales sin cambios. Su redibujo
se debe acordar expresamente con la marca; la prioridad no implica permiso para reemplazo.

## Verificación efectuada

- Libro XLSX exportado y reabierto con Artifact Tool: tres hojas y 54 imágenes.
- ZIP íntegro y XML del libro analizado sin errores; miniaturas realmente incrustadas.
- Revisados visualmente renders del catálogo, usos y guía, además de una hoja de
  contacto con todas las referencias y los controles condicionales de búsqueda/número.
- No se afirma apertura en Microsoft Excel de escritorio ni prueba física Android.
- No se ejecutó build/lint porque no se modificó código funcional.

## Entrega recomendada al artista

SVG para iconos y ornamentos vectoriales, con viewBox, transparencia y proporciones
conservadas. Comprobar legibilidad a los tamaños CSS indicados. PNG/WebP para raster,
con transparencia cuando corresponda y resolución suficiente; conservar archivo fuente.
No convertir cifras, etiquetas, gráficos de datos o controles nativos en imágenes.
Usar los IDs del Excel como nombre de entrega y actualizar el estado allí.

## Actualización artística — 14-11-2026

ORN-003 y el uso temporal ILU-001 ahora comparten la única fuente
`src/assets/illustrations/circus-tent-artist.svg` (1080 × 1080), copia intacta
del archivo entregado por el usuario. Excel, miniaturas y JSON actualizados.
Los SVG de referencia anteriores se identifican como anterior-no-utilizado.
Son dos usos semánticos de una misma obra; no dos encargos para el artista.
Medidas CSS: lateral 128 px, Inicio móvil hasta 120 (columna puede limitar a
100), escritorio hasta 330/360; tarjetas Eventos 190; destacado 150 desde 600.
Todos conservan proporción 1:1. Verificación aislada de componentes con CSS
real en 390, 425 y 1440 px: sin overflow horizontal ni distorsión. No se
probaron dispositivos físicos. Build/TypeScript, lint y 329 pruebas locales pasan.
