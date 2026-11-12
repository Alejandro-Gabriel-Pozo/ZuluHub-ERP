import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { accionesDeLaListaDeCaja } from "../../../../../../../servidor/modulos";
import { sucursalesAbiertasParaElegir } from "../../../../../../../servidor/sucursal-elegida";
import { FormularioDeCuenta } from "../../../../../../../ui/plantillas/caja/FormularioDeCuenta.cliente";
import {
  opcionesDeSucursal,
  opcionesDeTipoDeCuenta,
} from "../../../../../../../ui/plantillas/caja/modelo-de-cuentas-de-cobro";
import { ErrorDelDetalle } from "../../../../../../../ui/plantillas/facturacion/ErrorDelDetalle";
import { agregarCuentaAccion } from "../../../../acciones-de-cuentas-de-cobro";

// `/caja/cuentas-de-cobro/nuevo`: agregar una cuenta de cobro. Las sucursales que se ofrecen son las ABIERTAS que la persona puede elegir (el filtro vive en el servidor); la elegida
// se vuelve a validar contra el alcance en el caso de uso. Repetir el envío no duplica: el servidor devuelve la cuenta que ya existe.
export default async function PaginaDeAltaDeCuenta() {
  return pantallaDeOperacion({ titulo: "caja.cuentas.agregar" }, async ({ contexto }) => {
    const sucursales = await sucursalesAbiertasParaElegir(contexto);
    if (!sucursales.ok) return <ErrorDelDetalle error={sucursales.error} />;
    return (
      <FormularioDeCuenta
        original={null}
        tipos={opcionesDeTipoDeCuenta()}
        sucursales={opcionesDeSucursal(sucursales.dato)}
        accion={agregarCuentaAccion}
        textos={{
          nombre: texto({}, "caja.campo.nombre"),
          tipo: texto({}, "caja.campo.tipo"),
          identificador: texto({}, "caja.campo.identificador_opcional"),
          sucursal: texto({}, "caja.campo.sucursal"),
          guardar: texto({}, "caja.accion.guardar"),
        }}
        puedeGuardar={(await accionesDeLaListaDeCaja(contexto, "cuentas_de_cobro")).agregar}
      />
    );
  });
}
