import { errorDeCodigo } from "../../../../../../../../../../src/capacidades/experiencia/respuesta";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { cargarLaFichaDeCompra } from "../../../../../../../../servidor/compras";
import { nuevaClaveDeCorreccion } from "../../../../../../../../servidor/correccion-de-compra";
import { accionesDeLaCompra } from "../../../../../../../../servidor/ofertas-de-compras";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeCorregirLinea } from "../../../../../../../../ui/plantillas/compras/correccion/FormularioDeCorregirLinea.cliente";
import { rotuloDelPrecio } from "../../../../../../../../ui/plantillas/compras/ficha/modelo-de-ficha-de-compra";
import { textosDeCompras } from "../../../../../../../../ui/plantillas/compras/textos-de-compras";
import { corregirLaLineaAccion } from "../../../../../acciones-de-correccion-de-compra";

type PropsDePagina = Readonly<{ params: Promise<{ id: string; linea: string }> }>;

// `/compras/[id]/corregir/[linea]`: «Corregir» el precio de UNA línea de la compra (maqueta `compra-corregir-anular.html`, `vForm`). El id y el número de línea son lo único que viene de la dirección: la empresa,
// la persona y el alcance de sucursal los decide el servidor. Una compra o una línea que no existe, de otra empresa o de otra sucursal, o una línea sin precio o de una compra anulada, sale igual (el genérico).
// Nace cerrada: sin `compras.corregir` no hay formulario (y el servidor lo vuelve a verificar al corregir). Las correcciones que se vieron viajan ligadas a la acción: si otra persona corrigió antes, el
// servidor rechaza sin escribir. La clave de este intento la fija la página al abrirse.
export default async function PaginaDeCorregirLaLinea({ params }: PropsDePagina) {
  const { id, linea } = await params;
  return pantallaDeOperacion({ titulo: "compras.correccion.corregir" }, async ({ contexto }) => {
    const textos = textosDeCompras();
    const ficha = await cargarLaFichaDeCompra(contexto, id);
    if (!ficha.ok) return <ErrorDelDetalle error={ficha.error} />;
    const numero = /^\d{1,6}$/.test(linea) ? Number(linea) : null;
    const delaLinea = ficha.dato.lineas.find((l) => l.numero === numero);
    const acciones = await accionesDeLaCompra(contexto);
    if (
      delaLinea === undefined ||
      numero === null ||
      !acciones.corregir ||
      ficha.dato.estado === "ANULADA" ||
      delaLinea.importe === null
    ) {
      return <ErrorDelDetalle error={errorDeCodigo("COMPRAS_ACCION_NO_PERMITIDA")} />;
    }
    return conTitulo(
      `${textos.corregir} · ${delaLinea.producto ?? "—"}`,
      <FormularioDeCorregirLinea
        accion={corregirLaLineaAccion.bind(
          null,
          ficha.dato.recepcionId,
          numero,
          delaLinea.correccionesVistas,
          nuevaClaveDeCorreccion(),
        )}
        textos={{
          precio: rotuloDelPrecio(delaLinea, textos),
          motivo: textos.motivo,
          corregir: textos.corregir,
        }}
      />,
    );
  });
}
