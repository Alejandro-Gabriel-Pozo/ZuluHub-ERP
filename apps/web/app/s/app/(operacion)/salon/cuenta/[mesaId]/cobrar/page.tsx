import { errorDeCodigo } from "../../../../../../../../../../src/capacidades/experiencia/respuesta";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { cobroDeLaPagina } from "../../../../../../../../servidor/cobrar";
import { puedeCobrarLaMesa } from "../../../../../../../../servidor/ofertas-de-salon";
import { cargarLaFichaDeLaMesa } from "../../../../../../../../servidor/salon";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { textosDeCobrar } from "../../../../../../../../ui/plantillas/cobrar/textos-de-cobrar";
import { textosDeDividirEnElCobro } from "../../../../../../../../ui/plantillas/cobrar/textos-de-dividir-en-el-cobro";
import { textosDeDividir } from "../../../../../../../../ui/plantillas/salon/textos-de-dividir";
import { CobroDeLaMesa } from "../../../../../../../../ui/plantillas/salon/CobroDeLaMesa.cliente";
import { armarLaMesa } from "../../../../../../../../ui/plantillas/salon/modelo-de-la-mesa";
import {
  anularElTicketAccion,
  cobrarLaMesaAccion,
  papelDelTicketAccion,
} from "../../../../../acciones-de-cobrar";

type PropsDePagina = Readonly<{
  params: Promise<{ mesaId: string }>;
  searchParams: Promise<{ cuenta?: string | string[] }>;
}>;

// `/salon/cuenta/[mesaId]/cobrar` (SAL-D, S8; maqueta del recorrido del salón aprobada por el dueño el 25/11/2026): cobrar la cuenta de la mesa con la hoja de la venta rápida en modo «cuenta existente». La empresa, la persona
// y la sucursal las pone el servidor (de la dirección solo se lee el id de la mesa, que el servidor valida contra el mapa de la sucursal). El permiso (`cuentas.cerrar`, `tickets.cobrar` y `cuentas.anular`) lo decide el caso de
// uso; acá solo se cierra la pantalla si no se ofrece. Una mesa sin cuenta cobrable (libre, unida), con platos sin enviar o sin total en pesos es el genérico: el servidor igual lo rechazaría. En una mesa DIVIDIDA (SAL-E2) la cuenta a
// cobrar viene en la dirección (`?cuenta=`): solo vale si es una de las cuentas de ESA mesa, sin cobrar y con todos sus platos enviados; si no, el genérico. Cada cuenta se cobra sola; al cobrar la última la mesa queda libre.
export default async function PaginaDeCobrarLaMesa({ params, searchParams }: PropsDePagina) {
  const { mesaId } = await params;
  const { cuenta } = await searchParams;
  return pantallaDeOperacion({ titulo: "salon.texto.grupo_salon" }, async ({ contexto }) => {
    const ficha = await cargarLaFichaDeLaMesa({ mesaId });
    if (!ficha.ok) return <ErrorDelDetalle error={ficha.error} />;
    const mesa = armarLaMesa({}, ficha.dato);
    const generico = <ErrorDelDetalle error={errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA")} />;
    const permitido = await puedeCobrarLaMesa(contexto);
    // Una cuenta hija: la de la dirección, de ESTA mesa, sin cobrar y con todos sus platos enviados.
    const hija =
      typeof cuenta === "string" && mesa.modo === "SOLO_LECTURA"
        ? mesa.cuentasHijas.find((h) => h.cuentaId === cuenta && h.cobrable)
        : undefined;
    const delaMesa =
      mesa.modo === "CON_CUENTA" &&
      mesa.cuentaId !== null &&
      mesa.totalACobrar !== null &&
      !mesa.hayParaEnviar &&
      !mesa.hayEnEspera &&
      !mesa.sinPlatos &&
      cuenta === undefined
        ? { cuentaId: mesa.cuentaId, total: mesa.totalACobrar }
        : undefined;
    const aCobrar =
      hija?.totalACobrar == null ? delaMesa : { cuentaId: hija.cuentaId, total: hija.totalACobrar };
    if (!permitido || aCobrar === undefined) return generico;
    const preparado = await cobroDeLaPagina(contexto);
    if (!preparado.ok) return <ErrorDelDetalle error={preparado.error} />;
    const t = textosDeDividir();
    return conTitulo(
      mesa.titulo,
      <CobroDeLaMesa
        mesaId={mesaId}
        cuentaId={aCobrar.cuentaId}
        total={aCobrar.total}
        preparado={preparado.dato}
        textos={textosDeCobrar()}
        textosDeDividir={textosDeDividirEnElCobro()}
        deLaDivision={
          hija === undefined
            ? undefined
            : {
                // Es la última si ninguna otra cuenta de la mesa sigue sin cobrar.
                ultima: mesa.cuentasHijas.every((h) => h.cobrada || h.cuentaId === hija.cuentaId),
                volverALasCuentas: t.volverALasCuentas,
                mesaCobrada: t.mesaCobrada,
              }
        }
        acciones={{
          cobrar: cobrarLaMesaAccion,
          anular: anularElTicketAccion,
          imprimir: papelDelTicketAccion,
        }}
      />,
    );
  });
}
