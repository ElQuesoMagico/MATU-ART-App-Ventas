# Recursos artísticos reemplazables

`manifest.json` es el inventario vigente (rutas relativas a la raíz del proyecto;
el fragmento `#` indica un símbolo SVG, variante JSX o selector CSS).
`artisticAssets.ts` centraliza las referencias a ilustraciones externas activas.
No interviene en precios, ventas, eventos ni inventario.

## Política de origen

- `confirmed-ai`: hay evidencia de intervención generativa. El arte es un
  placeholder temporal hasta su sustitución por un artista.
- `not-ai`: existe evidencia de autoría/procedencia no generativa.
- `pending-verification`: no hay evidencia suficiente. **No significa IA**.

La extracción de un SVG de JSX a un archivo no demuestra quién creó su dibujo.
Por eso la carpa, muestras de productos, ornamentos y marca anterior siguen
pendientes. El CSS ornamental nuevo de estadísticas sí se identifica como
creado por el asistente. Los gráficos de datos son componentes funcionales.
Las imágenes del usuario están en IndexedDB y no deben asumirse generadas por IA.

## Organización y sustitución

- `placeholders/illustrations/circus-tent.svg`: símbolo `circus-tent`, 320 × 300.
  Usado por `CircusIllustration` en Inicio y Eventos. Colores heredados mediante
  `--accent`, `--cherry`, `--canvas`, `--ink`. Mantener transparencia y proporción.
- `placeholders/illustrations/product-samples.svg`: seis símbolos `product-*`,
  180 × 150. Ilustraciones legacy sin uso en el catálogo real; no se insertan datos.
- `branding/`: logo oficial MATU ART proporcionado por el usuario, sin editar.
- `brand/`: documentación de la marca anterior, conservada para trazabilidad.
- Ornamentos SVG cortos e íconos funcionales siguen centralizados en sus
  componentes. Los identificadores del manifiesto permiten reemplazarlos allí.
- Decoraciones CSS: entradas individuales con archivo y selectores. No hace
  falta convertir muescas, bordes o rayas en imágenes.
- Archivos de plantilla sin uso permanecen en su ubicación original.

Para sustituir una ilustración, cambiar el archivo conservando símbolo/viewBox,
o actualizar solo `artisticAssets.ts` y el wrapper. Se usa `?no-inline` para que
`<use>` resuelva un SVG local externo también en producción. No introducir URLs
externas: todos los recursos deben seguir disponibles con la app cargada.

Mantener en el manifiesto ID, nombre, ruta, origen y evidencia, pantallas,
componentes, dimensiones, formato, estado y pautas para el artista. Al reemplazar,
registrar autoría, licencia, fecha y procedencia; no borrar el identificador.
Probar a 390 × 844, 425 × 876 y escritorio, así como las etiquetas accesibles.
Si se añaden carpetas de iconos/decoraciones en futuras etapas, usar nombres
descriptivos; no crear copias duplicadas de recursos activos.

## Entrega futura (pendiente)

Después de integrar Google Sheets se preparará el PDF visual y Excel inventario
con **todos** los recursos incorporados hasta entonces. No se generan en 7.1.
Antes de esa entrega hay que resolver autorías pendientes y revisar, con permiso,
las imágenes de productos de cada base local; el manifiesto actual documenta esa
colección dinámica por UUID sin extraer datos personales.

### Actualización 7.2

El logo y `branding/clown-icon.png` son recursos oficiales aportados por el usuario.
El manifiesto registra el icono nuevo, el reemplazo de rosette/starburst y las máscaras
CSS de tickets. Estas máscaras son decoración de código creada por el asistente;
los originales PNG no se alteraron. Las autorías pendientes de otros recursos
siguen pendientes. No se generó el PDF ni el Excel de entrega artística definitiva.

### Actualización 7.3

`TicketFrame.tsx` y `ticketGeometry.ts` sustituyen las máscaras de las tarjetas por
un contorno SVG continuo y reutilizable, registrado como decoración generada y
reemplazable en el manifiesto. `tickets.css` centra el payaso mediante los límites
alfa (245,633)-(1106,1394) del PNG de 1414 × 2000. El archivo oficial no se recortó
ni modificó. El PDF financiero usa el logo oficial; no es el catálogo artístico
definitivo, cuya entrega continúa pendiente de la futura integración con Sheets.
