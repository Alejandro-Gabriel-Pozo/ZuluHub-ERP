# Cartas de ejemplo (C-0)

Datos tipados para probar la carta sin base de datos. Los usa C-2 (carta en `apps/web` contra un puerto
falso) y los prototipos de C-1b. Son **inventados**: nombres, precios y "fotos" no son de ningún cliente.

| Archivo        | Carta               | Modelo elegido | Qué ejercita                                                                    |
| -------------- | ------------------- | -------------- | ------------------------------------------------------------------------------- |
| `cafeteria.ts` | La Esquina Café     | ninguno        | 60 productos en 6 secciones; tamaños, guarniciones sin recargo, adicionales     |
| `panaderia.ts` | Panadería El Trigal | `CUADRICULA`   | fotos `VISIBLE`, `OCULTA` y `ROTA`; productos sin foto; venta por docena        |
| `hosteria.ts`  | Los Cardones        | `LIBRO`        | pocos platos, carta de vinos (copa o botella), importes con fracción de centavo |
| `barberia.ts`  | Navaja y Tijera     | ninguno        | servicios (no comidas), recargo por largo, sin fotos                            |

`index.ts` exporta las cuatro (`VIDRIERAS_DE_EJEMPLO`); `tipos.ts` define la forma.

## Estructura

`VidrieraDeEjemplo` → `secciones[]` → `productos[]`. Cada producto trae lo que lee la puerta pública
(`id`, `nombre`, `descripcion`, `agotado`, `foto`) y los grupos de precio de `ProductoParaPrecios`
(`precioBase`, `tamanos`, `obligatorios`, `adicionales`), así que se le puede pasar tal cual a
`listaDePreciosDelProducto`. El orden de los arreglos es el orden de la carta.

- **Dinero:** siempre texto decimal (`"2300"`, `"24500.250000"`), nunca `number`. Precio base y recargos son
  `numeric(18,6)` con IVA incluido; la pantalla recibe importes ya redondeados a centavos.
- **Ids:** con forma de UUID v4 y deterministas (`idDeEjemplo`); sirven para `direccionDeProducto`.
- **Fotos:** `direccion` es una ruta propia del host de la carta y no apunta a un archivo real; solo las
  `VISIBLE` cuentan para el modelo efectivo. `alt: null` = el comerciante no cargó texto alternativo.
- **Plan:** `perillasEncendidas` es el plan de la empresa de ejemplo, para probar `modeloEfectivo`.

La prueba `src/capacidades/experiencia/vidriera/vidrieras-de-ejemplo.test.ts` valida que las cuatro cumplan
estas reglas (60 productos, importes válidos, descripciones válidas, ids únicos, direcciones sin choques).
