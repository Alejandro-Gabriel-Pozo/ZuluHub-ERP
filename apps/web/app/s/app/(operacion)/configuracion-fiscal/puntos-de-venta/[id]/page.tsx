import { errorDeCodigo } from "../../../../../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { cargarLosPuntosDeVenta } from "../../../../../../../servidor/configuracion-fiscal";
import { accionesDePuntosDeVenta } from "../../../../../../../servidor/modulos";
import { sucursalesAbiertasParaElegir } from "../../../../../../../servidor/sucursal-elegida";
import { DetalleDelPuntoDeVenta } from "../../../../../../../ui/plantillas/configuracion-fiscal/DetalleDelPuntoDeVenta.cliente";
import { FormularioDePuntoDeVenta } from "../../../../../../../ui/plantillas/configuracion-fiscal/FormularioDePuntoDeVenta.cliente";
import {
  RUTAS_DE_CONFIGURACION,
  rutaDeUnPuntoDeVenta,
} from "../../../../../../../ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta";
import { ConMigas } from "../../../../../../../ui/plantillas/configuracion-fiscal/MigasDeConfiguracion";
import {
  accionesDelPuntoDeVenta,
  armarElPuntoDeVenta,
  tituloDelPuntoDeVenta,
} from "../../../../../../../ui/plantillas/configuracion-fiscal/modelo-de-puntos-de-venta";
import { ErrorDelDetalle } from "../../../../../../../ui/plantillas/facturacion/ErrorDelDetalle";
import { cambiarAmbienteAccion } from "../../../../acciones-de-facturacion";
import {
  activarPuntoDeVentaAccion,
  desactivarPuntoDeVentaAccion,
  editarPuntoDeVentaAccion,
} from "../../../../acciones-de-config-fiscal";

type PropsDePagina = Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

const MIGAS = [
  { texto: texto({}, "fiscal.pantalla.config_titulo"), href: RUTAS_DE_CONFIGURACION.lista },
  {
    texto: texto({}, "fiscal.pantalla.config_puntos_de_venta"),
    href: RUTAS_DE_CONFIGURACION.puntosDeVenta,
  },
];

// `/configuracion-fiscal/puntos-de-venta/[id]`: un punto de venta (activar, desactivar, pasar a producción) y, con `?editar=1`, su
// edición. El id de la dirección es lo único que viene del navegador: se busca entre los puntos de venta del emisor de la empresa;
// uno que no está ahí (ajeno, inexistente, mal escrito) es «no encontrado» y no dice cuál de los dos casos es.
export default async function PaginaDeUnPuntoDeVenta({ params, searchParams }: PropsDePagina) {
  const { id } = await params;
  const editando = (await searchParams)["editar"] === "1";
  return pantallaDeOperacion(
    { titulo: "fiscal.pantalla.config_puntos_de_venta" },
    async ({ contexto }) => {
      const puntos = await cargarLosPuntosDeVenta(contexto);
      if (!puntos.ok) return <ErrorDelDetalle error={puntos.error} />;
      const punto = puntos.dato.items.find((p) => p.id === id);
      if (punto === undefined) {
        return <ErrorDelDetalle error={errorDeCodigo("FISCAL_PUNTO_DE_VENTA_NO_ENCONTRADO")} />;
      }
      const titulo = tituloDelPuntoDeVenta(punto.numero);
      const acciones = await accionesDePuntosDeVenta(contexto);
      if (!editando) {
        return conTitulo(
          titulo,
          <ConMigas tramos={MIGAS}>
            <DetalleDelPuntoDeVenta
              armado={armarElPuntoDeVenta(punto)}
              punto={{ id: punto.id, activo: punto.activo, version: punto.version }}
              activar={activarPuntoDeVentaAccion}
              desactivar={desactivarPuntoDeVentaAccion}
              cambiarAmbiente={cambiarAmbienteAccion}
              rutaDeEdicion={`${rutaDeUnPuntoDeVenta(punto.id)}?editar=1`}
              acciones={accionesDelPuntoDeVenta(acciones, punto)}
            />
          </ConMigas>,
        );
      }
      // D-79 (`facturador-contratos-de-pantalla.md`, confirmada por el dueño el 2026-10-29): no se puede mudar un punto de venta a una
      // sucursal cerrada, así que solo se ofrecen las abiertas. Mudarlo DESDE una cerrada sí se puede, y editar sin cambiar la sucursal
      // también: la actual se ofrece siempre, aunque esté cerrada (así no se cambia sin querer). El servidor valida igual.
      const sucursales = await sucursalesAbiertasParaElegir(contexto);
      if (!sucursales.ok) return <ErrorDelDetalle error={sucursales.error} />;
      const opciones = sucursales.dato.some((s) => s.id === punto.sucursal.id)
        ? sucursales.dato
        : [...sucursales.dato, punto.sucursal];
      return conTitulo(
        titulo,
        <ConMigas tramos={MIGAS}>
          <FormularioDePuntoDeVenta
            emisorId={puntos.dato.emisorId}
            original={punto}
            sucursales={opciones.map((s) => ({
              valor: s.id,
              etiqueta: s.activa
                ? s.nombre
                : texto({}, "fiscal.pantalla.listado_sucursal_cerrada", { nombre: s.nombre }),
            }))}
            guardar={editarPuntoDeVentaAccion}
            rutaAlTerminar={rutaDeUnPuntoDeVenta(punto.id)}
            rutaAlCancelar={rutaDeUnPuntoDeVenta(punto.id)}
            oferta={acciones.editar}
          />
        </ConMigas>,
      );
    },
  );
}
