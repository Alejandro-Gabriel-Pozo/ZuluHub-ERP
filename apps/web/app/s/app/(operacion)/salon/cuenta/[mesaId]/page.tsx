import { errorDeCodigo } from "../../../../../../../../../src/capacidades/experiencia/respuesta";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import {
  puedeAdministrarImpresoras,
  puedeCambiarDeMesa,
  puedeEnviarAComandas,
  puedeImprimir,
  puedeReimprimir,
} from "../../../../../../../servidor/modulos";
import {
  cargarElMapaDeMesas,
  cargarLaFichaDeLaMesa,
  nuevoIdDeCuentaDeMesa,
} from "../../../../../../../servidor/salon";
import { puedeCobrarLaMesa, puedeUnirMesas } from "../../../../../../../servidor/ofertas-de-salon";
import { cargarLaVentaRapida } from "../../../../../../../servidor/venta-rapida";
import { armarLosTextosDeImprimir } from "../../../../../../../ui/patrones/papel/textos-de-imprimir";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import {
  armarLaMesa,
  mesasLibresParaElCambio,
  mesasParaUnir,
  textosDeLaMesa,
} from "../../../../../../../ui/plantillas/salon/modelo-de-la-mesa";
import { RUTA_DE_IMPRESORAS } from "../../../../../../../ui/plantillas/salon/modelo-de-impresoras";
import { PantallaDeLaMesa } from "../../../../../../../ui/plantillas/salon/PantallaDeLaMesa.cliente";
import { textosDeLaVenta } from "../../../../../../../ui/plantillas/venta/modelo-de-venta-rapida";
import {
  agregarAlPedidoAccion,
  anularItemEnviadoAccion,
  cambiarDeMesaAccion,
  cambiarSalidaAccion,
  unirMesasAccion,
  declararImpresionAccion,
  enviarACocinaAccion,
  imprimirDocumentoAccion,
  liberarMesaAccion,
  papelDelDocumentoAccion,
  pedirQueSalgaAccion,
  quitarSinEnviarAccion,
  reimprimirDocumentoAccion,
  tomarPedidoAccion,
} from "../../../../acciones-de-salon";
import { cotizarElCarritoAccion } from "../../../../acciones-de-venta-rapida";

type PropsDePagina = Readonly<{ params: Promise<{ mesaId: string }> }>;

// `/salon/cuenta/[mesaId]` (SAL-B; maquetas `salon.html` y `salida.html`): la ficha de una mesa de la sucursal con la que se trabaja. La empresa, la persona y la sucursal las pone el servidor (nunca la dirección: de ella
// solo se lee el id de la mesa, que el servidor valida contra el mapa de la sucursal; una mesa de otra sucursal o que no existe da el genérico). El permiso (`mesas.ver`), la perilla `salon` y el módulo los decide la
// consulta. Lo que se ofrece para agregar es lo de la venta rápida (`productos.ver`); si no se puede leer, la mesa se muestra sin «agregar». «Cambiar de mesa» solo se ofrece a quien puede (`salon.cambiar_mesa`).
// El id de la cuenta de «Tomar pedido» lo fija esta página una vez (recargar es otro intento). SAL-C suma la cocina: enviar, pedir que salga, anular un ítem enviado, imprimir y copiar (cada botón solo a quien puede).
export default async function PaginaDeLaMesa({ params }: PropsDePagina) {
  const { mesaId } = await params;
  return pantallaDeOperacion({ titulo: "salon.texto.grupo_salon" }, async ({ contexto }) => {
    const ficha = await cargarLaFichaDeLaMesa({ mesaId });
    if (!ficha.ok) return <ErrorDelDetalle error={ficha.error} />;
    const mesa = armarLaMesa({}, ficha.dato);
    const conCuenta = mesa.modo === "CON_CUENTA";
    const venta = conCuenta ? await cargarLaVentaRapida(contexto) : null;
    const catalogo =
      venta?.ok === true && !venta.dato.incompleta
        ? {
            secciones: venta.dato.secciones,
            productos: venta.dato.productos,
            textos: textosDeLaVenta(),
            cotizar: cotizarElCarritoAccion,
          }
        : null;
    const libres =
      conCuenta && (await puedeCambiarDeMesa(contexto))
        ? await cargarElMapaDeMesas({ filtro: "LIBRES" })
        : null;
    // Lo que la persona puede hacer con la cocina: solo ayudas que apagan o quitan botones (el servidor decide cada acción).
    const cocina = conCuenta
      ? {
          enviar: await puedeEnviarAComandas(contexto),
          imprimir: await puedeImprimir(contexto),
          reimprimir: await puedeReimprimir(contexto),
          cobrar: await puedeCobrarLaMesa(contexto),
          unir: await puedeUnirMesas(contexto),
        }
      : { enviar: false, imprimir: false, reimprimir: false, cobrar: false, unir: false };
    // Las mesas a las que se puede unir esta: solo si se ofrece unir; si no se pudo leer el mapa, no se ofrece.
    const mapa = cocina.unir ? await cargarElMapaDeMesas({ filtro: "TODAS" }) : null;
    const paraUnir = mapa?.ok === true ? mesasParaUnir({}, mapa.dato.mesas, mesaId) : null;
    const configurarImpresoras = conCuenta && (await puedeAdministrarImpresoras(contexto));
    return conTitulo(
      mesa.titulo,
      <>
        {venta !== null && catalogo === null ? (
          <ErrorDelDetalle
            error={venta.ok ? errorDeCodigo("VENTAS_ACCION_NO_PERMITIDA") : venta.error}
          />
        ) : null}
        <PantallaDeLaMesa
          mesaId={mesaId}
          mesa={mesa}
          textos={textosDeLaMesa()}
          acciones={{
            tomarPedido: tomarPedidoAccion,
            agregar: agregarAlPedidoAccion,
            cambiarSalida: cambiarSalidaAccion,
            quitar: quitarSinEnviarAccion,
            liberar: liberarMesaAccion,
            cambiarDeMesa: cambiarDeMesaAccion,
            unir: unirMesasAccion,
            enviar: enviarACocinaAccion,
            pedirQueSalga: pedirQueSalgaAccion,
            anular: anularItemEnviadoAccion,
            imprimir: imprimirDocumentoAccion,
            reimprimir: reimprimirDocumentoAccion,
            declarar: declararImpresionAccion,
            papel: papelDelDocumentoAccion,
          }}
          textosDeImprimir={armarLosTextosDeImprimir()}
          puede={cocina}
          mesasParaUnir={paraUnir}
          rutaDeImpresoras={configurarImpresoras ? RUTA_DE_IMPRESORAS : null}
          cuentaNuevaId={nuevoIdDeCuentaDeMesa()}
          mesasLibres={
            libres?.ok === true
              ? mesasLibresParaElCambio({}, libres.dato.mesas, mesaId)
              : libres === null
                ? null
                : []
          }
          catalogo={catalogo}
        />
      </>,
    );
  });
}
