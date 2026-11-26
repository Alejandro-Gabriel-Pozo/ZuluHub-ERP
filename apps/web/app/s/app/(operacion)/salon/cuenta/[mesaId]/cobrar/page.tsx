import { errorDeCodigo } from "../../../../../../../../../../src/capacidades/experiencia/respuesta";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { cobroDeLaPagina } from "../../../../../../../../servidor/cobrar";
import { puedeCobrarLaMesa } from "../../../../../../../../servidor/ofertas-de-salon";
import { cargarLaFichaDeLaMesa } from "../../../../../../../../servidor/salon";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { textosDeCobrar } from "../../../../../../../../ui/plantillas/cobrar/textos-de-cobrar";
import { CobroDeLaMesa } from "../../../../../../../../ui/plantillas/salon/CobroDeLaMesa.cliente";
import { armarLaMesa } from "../../../../../../../../ui/plantillas/salon/modelo-de-la-mesa";
import {
  anularElTicketAccion,
  cobrarLaMesaAccion,
  papelDelTicketAccion,
} from "../../../../../acciones-de-cobrar";

type PropsDePagina = Readonly<{ params: Promise<{ mesaId: string }> }>;

// `/salon/cuenta/[mesaId]/cobrar` (SAL-D, S8; maqueta del recorrido del salón aprobada por el dueño el 25/11/2026): cobrar la cuenta de la mesa con la hoja de la venta rápida en modo «cuenta existente». La empresa, la persona
// y la sucursal las pone el servidor (de la dirección solo se lee el id de la mesa, que el servidor valida contra el mapa de la sucursal). El permiso (`cuentas.cerrar`, `tickets.cobrar` y `cuentas.anular`) lo decide el caso de
// uso; acá solo se cierra la pantalla si no se ofrece. Una mesa sin cuenta cobrable (libre, unida, dividida), con platos sin enviar o sin total en pesos es el genérico: el servidor igual lo rechazaría.
export default async function PaginaDeCobrarLaMesa({ params }: PropsDePagina) {
  const { mesaId } = await params;
  return pantallaDeOperacion({ titulo: "salon.texto.grupo_salon" }, async ({ contexto }) => {
    const ficha = await cargarLaFichaDeLaMesa({ mesaId });
    if (!ficha.ok) return <ErrorDelDetalle error={ficha.error} />;
    const mesa = armarLaMesa({}, ficha.dato);
    const generico = <ErrorDelDetalle error={errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA")} />;
    if (
      mesa.modo !== "CON_CUENTA" ||
      mesa.cuentaId === null ||
      mesa.totalACobrar === null ||
      mesa.hayParaEnviar ||
      mesa.hayEnEspera ||
      mesa.sinPlatos ||
      !(await puedeCobrarLaMesa(contexto))
    ) {
      return generico;
    }
    const preparado = await cobroDeLaPagina(contexto);
    if (!preparado.ok) return <ErrorDelDetalle error={preparado.error} />;
    return conTitulo(
      mesa.titulo,
      <CobroDeLaMesa
        mesaId={mesaId}
        cuentaId={mesa.cuentaId}
        total={mesa.totalACobrar}
        preparado={preparado.dato}
        textos={textosDeCobrar()}
        acciones={{
          cobrar: cobrarLaMesaAccion,
          anular: anularElTicketAccion,
          imprimir: papelDelTicketAccion,
        }}
      />,
    );
  });
}
