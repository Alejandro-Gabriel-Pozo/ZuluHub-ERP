import { formatearImporte } from "../../patrones/formato-fiscal";
import estilos from "./Cobrar.module.css";
import type { LineaDeEstado } from "./modelo-de-cobro";
import type { TextosDeCobrar } from "./textos-de-cobrar";

/** Lo que falta, lo que sobra, el vuelto o «Cobro completo»: siempre con su texto, nunca solo por color. */
export function LineaDelEstado({
  linea,
  textos,
}: Readonly<{ linea: LineaDeEstado; textos: TextosDeCobrar }>) {
  if (linea === null) return <p className={estilos["estado"]} role="status" />;
  const formato = (importe: string) => formatearImporte(importe);
  switch (linea.tipo) {
    case "VUELTO":
      return (
        <p className={estilos["estado"]} role="status" data-estado="vuelto">
          {textos.vuelto} {formato(linea.importe)}
        </p>
      );
    case "FALTA":
      return (
        <p className={estilos["estado"]} role="status" data-estado="falta">
          {textos.faltaCobrar} {formato(linea.importe)}
        </p>
      );
    case "SOBRA":
      return (
        <p className={estilos["estado"]} role="status" data-estado="sobra">
          {textos.sobran} {formato(linea.importe)}
        </p>
      );
    case "COMPLETO":
      return (
        <p className={estilos["estado"]} role="status" data-estado="completo">
          {textos.cobroCompleto}
        </p>
      );
  }
}
