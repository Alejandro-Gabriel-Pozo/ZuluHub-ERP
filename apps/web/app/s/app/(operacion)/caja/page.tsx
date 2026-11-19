import { LARGO_MAXIMO_DE_LA_EXPLICACION } from "../../../../../../../src/modulos/cierre/publico";
import { pantallaDeOperacion } from "../../../../../pantallas/operacion";
import {
  cargarElConteoDeLaCaja,
  cargarLaCajaDeLaSucursal,
} from "../../../../../servidor/sesion-de-caja";
import { accionesDeLaPantallaDeCaja } from "../../../../../servidor/ofertas-de-caja";
import { ErrorDelDetalle } from "../../../../../ui/patrones/ErrorDelDetalle";
import { ESTADOS_DE_CAJA } from "../../../../../ui/plantillas/caja/modelo-de-la-caja";
import {
  PantallaDeCaja,
  type CajaParaDibujar,
} from "../../../../../ui/plantillas/caja/PantallaDeCaja";
import {
  abrirCajaAccion,
  cancelarCierreDeCajaAccion,
  cerrarCajaAccion,
  iniciarCierreDeCajaAccion,
} from "../../acciones-de-sesion-de-caja";

// `/caja`: la pantalla «Caja» del mostrador de la sucursal elegida en el dispositivo (maqueta `caja.html`): abrir, jornada, contar y cerrar. Sin sucursal elegida no se asume «todas»: sale el
// genérico. Con el módulo `caja` en desarrollo el servidor rechaza la lectura y sale su motivo. Con una sesión en cierre se lee además lo que hay que contar.
export default async function PaginaDeLaCaja() {
  return pantallaDeOperacion({ titulo: "caja.pantalla.titulo" }, async ({ contexto }) => {
    const lectura = await cargarLaCajaDeLaSucursal(contexto);
    if (!lectura.ok) return <ErrorDelDetalle error={lectura.error} />;
    const cajas: readonly CajaParaDibujar[] = await Promise.all(
      lectura.dato.cajas.map(async (caja): Promise<CajaParaDibujar> => {
        if (caja.estado !== ESTADOS_DE_CAJA.enCierre || caja.sesion === null) {
          return { caja, conteo: null, errorDelConteo: null };
        }
        const conteo = await cargarElConteoDeLaCaja(contexto, { sesionId: caja.sesion.sesionId });
        return conteo.ok
          ? { caja, conteo: conteo.dato, errorDelConteo: null }
          : { caja, conteo: null, errorDelConteo: conteo.error };
      }),
    );
    return (
      <PantallaDeCaja
        cajas={cajas}
        permisos={await accionesDeLaPantallaDeCaja(contexto)}
        acciones={{
          abrir: abrirCajaAccion,
          iniciarCierre: iniciarCierreDeCajaAccion,
          cancelarCierre: cancelarCierreDeCajaAccion,
          cerrar: cerrarCajaAccion,
        }}
        largoMaximoDelTexto={LARGO_MAXIMO_DE_LA_EXPLICACION}
      />
    );
  });
}
