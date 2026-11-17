/**
 * Los componentes de botón y de modal que la ficha de pantalla vigila (`Pedernal-docs/11-especificaciones/ficha-de-pantalla-diseno.md`
 * §4, reglas P1 y P4), igual que `COMPONENTES_DE_CAMPO` (`datos/registro.ts`) lo hace con los campos. Son las IMPLEMENTACIONES: el
 * analizador no cuenta lo que hay adentro de estos archivos, solo los usos que hacen las pantallas. Un componente de botón o de modal
 * nuevo se suma acá (una prueba comprueba que cada ruta exista).
 */
export const COMPONENTES_DE_BOTON = [
  "apps/web/ui/componentes/Boton.cliente.tsx",
  "apps/web/ui/componentes/BotonIcono.tsx",
  "apps/web/ui/patrones/BotonDeEnvio.cliente.tsx",
] as const;

export const COMPONENTES_DE_MODAL = ["apps/web/ui/patrones/Superposicion.tsx"] as const;
