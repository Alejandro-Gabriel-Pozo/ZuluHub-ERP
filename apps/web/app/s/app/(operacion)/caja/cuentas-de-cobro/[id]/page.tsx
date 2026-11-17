import { errorDeCodigo } from "../../../../../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { cargarLasCuentas } from "../../../../../../../servidor/cuentas-de-cobro";
import { accionesDeLaListaDeCaja } from "../../../../../../../servidor/modulos";
import { sucursalesAbiertasParaElegir } from "../../../../../../../servidor/sucursal-elegida";
import { FormularioDeCuenta } from "../../../../../../../ui/plantillas/caja/FormularioDeCuenta.cliente";
import {
  opcionesDeSucursal,
  opcionesDeTipoDeCuenta,
} from "../../../../../../../ui/plantillas/caja/modelo-de-cuentas-de-cobro";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { editarCuentaAccion } from "../../../../acciones-de-cuentas-de-cobro";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/caja/cuentas-de-cobro/[id]`: editar una cuenta (nombre, identificador y sucursal; el tipo no se cambia). El id de la dirección es lo único que viene del navegador: se busca
// entre las cuentas a las que llega la persona; una que no está ahí (ajena, inexistente, mal escrita) sale como el genérico y no dice cuál de los casos es. La acción lleva la versión que se vio.
export default async function PaginaDeUnaCuenta({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "caja.accion.editar" }, async ({ contexto }) => {
    const cuentas = await cargarLasCuentas(contexto);
    if (!cuentas.ok) return <ErrorDelDetalle error={cuentas.error} />;
    const cuenta = cuentas.dato.cuentas.find((c) => c.id === id);
    if (cuenta === undefined) {
      return <ErrorDelDetalle error={errorDeCodigo("CAJA_ACCION_NO_PERMITIDA")} />;
    }
    const abiertas = await sucursalesAbiertasParaElegir(contexto);
    if (!abiertas.ok) return <ErrorDelDetalle error={abiertas.error} />;
    return (
      <FormularioDeCuenta
        original={cuenta}
        tipos={opcionesDeTipoDeCuenta()}
        sucursales={opcionesDeSucursal(abiertas.dato)}
        accion={editarCuentaAccion.bind(null, cuenta.id, cuenta.version)}
        textos={{
          nombre: texto({}, "caja.campo.nombre"),
          tipo: texto({}, "caja.campo.tipo"),
          identificador: texto({}, "caja.campo.identificador_opcional"),
          sucursal: texto({}, "caja.campo.sucursal"),
          guardar: texto({}, "caja.accion.guardar"),
        }}
        puedeGuardar={(await accionesDeLaListaDeCaja(contexto, "cuentas_de_cobro")).editar}
      />
    );
  });
}
