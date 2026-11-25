import { pantallaDeOperacion, conTitulo } from "../../../../../../../pantallas/operacion";
import {
  accionesDeLaRecepcion,
  cargarLaFichaDeRecepcion,
  cargarLosDepositosParaConfirmar,
} from "../../../../../../../servidor/recepciones";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeDetalleDeRecepcion } from "../../../../../../../ui/plantillas/compras/recepciones/PantallaDeDetalleDeRecepcion";
import { textosDeRecepciones } from "../../../../../../../ui/plantillas/compras/recepciones/textos-de-recepciones";
import {
  anularRecepcionAccion,
  confirmarRecepcionAccion,
} from "../../../../acciones-de-recepciones";

// `/compras/recepciones/[id]`: el detalle de una recepción (maqueta `compra-recibir.html`, estados «Por confirmar» y «Confirmada»). El id es lo único que viene de la URL: la empresa, la persona y el alcance de
// sucursal los decide el servidor. Un id mal escrito, de otra empresa o de otra sucursal sale igual que uno que no existe (el genérico). «Confirmar recepción» y «Anular recepción» se ofrecen solo con la recepción «Por
// confirmar» y el permiso (gerente y administrador); el servidor los vuelve a verificar al actuar; la recepción la liga la página con `.bind`.
export default async function PaginaDelDetalleDeRecepcion({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "compras.recepcion.titulo_lista" }, async ({ contexto }) => {
    const ficha = await cargarLaFichaDeRecepcion(contexto, id);
    if (!ficha.ok) return <ErrorDelDetalle error={ficha.error} />;
    const textos = textosDeRecepciones();
    const acciones = await accionesDeLaRecepcion(contexto);
    return conTitulo(
      `${textos.recepcion} ${String(ficha.dato.numero)}`,
      <PantallaDeDetalleDeRecepcion
        ficha={ficha.dato}
        textos={textos}
        acciones={acciones}
        accionDeConfirmar={confirmarRecepcionAccion.bind(null, ficha.dato.recepcionId)}
        accionDeAnular={anularRecepcionAccion.bind(null, ficha.dato.recepcionId)}
        depositos={
          acciones.confirmar && ficha.dato.estado === "PENDIENTE_DE_CONFIRMAR"
            ? await cargarLosDepositosParaConfirmar(contexto)
            : []
        }
      />,
    );
  });
}
