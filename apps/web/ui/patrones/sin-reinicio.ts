import type { SyntheticEvent } from "react";

/**
 * Cancela el REINICIO automático de un formulario con acción. React 19 reinicia el formulario al terminar la acción (siempre, con éxito o con error) un rato DESPUÉS de que el botón queda libre,
 * y el reinicio devuelve cada casilla y cada campo al valor con el que se dibujó la primera vez. Los campos CONTROLADOS (su valor vive en un estado) quedan mostrando eso mientras el estado dice
 * otra cosa: la pantalla muestra una cosa y el siguiente envío manda otra (caso real, 26/11/2026: tras guardar las sucursales de un empleado las casillas volvían a «solo Centro» y el próximo
 * «Guardar» mandaba otro conjunto). Y tras un error se perdía lo que la persona había escrito. Cancelar el evento `reset` deja el formulario como estaba.
 * Va en TODO `<form action={…}>` con una acción de React (lo exige `test/arquitectura/formularios-sin-reinicio.test.ts`); `FormularioDeAccion` ya lo trae.
 */
export const sinReiniciar = (evento: SyntheticEvent<HTMLFormElement>): void => {
  evento.preventDefault();
};
