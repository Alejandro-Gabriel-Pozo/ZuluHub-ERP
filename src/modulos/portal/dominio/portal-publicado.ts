import type { AlcanceDelHost } from "../../../capacidades/experiencia/puerta";
import { estadoEfectivo, puedeOperar } from "../../../contexto/estados";
import type { PortalPublicado } from "../../../puertos/portal-publico";
import type { EstadoDeEmpresa, EstadoDeTenant } from "../../../contexto/estados";
import type { EmpresaId, TenantId } from "../../../primitivas/identificadores/marca";
import { textoDesdeCentesimas, type DatosDelPortal, type Tarjeta, type Zona } from "./portal";

/** La carta en línea de una sucursal del portal: lo que hace falta para enlazar la tarjeta o la zona. */
export type CartaDelPortal = Readonly<{ sucursalId: string; codigo: string; nombre: string }>;

export type PortalLeido = Readonly<{
  /** Las sucursales ABIERTAS que la política deja ver en este portal (con tarjeta o zona visible y carta en línea). Una cerrada no sale. */
  sucursalesAbiertas: readonly string[];
  id: string;
  codigo: string;
  empresaId: EmpresaId;
  tenantId: TenantId;
  /** La marca del tenant: el host por el que se entra tiene que ser de esa marca. */
  marcaId: string;
  estadoDeLaEmpresa: EstadoDeEmpresa;
  estadoDelTenant: EstadoDeTenant;
  datos: DatosDelPortal;
  /** Solo las visibles y de sucursales abiertas con su carta en línea (lo deciden las políticas de 0078, no esta lectura). */
  tarjetas: readonly Tarjeta[];
  zonas: readonly Zona[];
  /** Las cartas EN LÍNEA de la empresa del portal y de ninguna otra (política `carta_publica_publico_de_portal`). */
  cartas: readonly CartaDelPortal[];
}>;

/**
 * Del portal que lee la puerta pública a lo que ve el comensal: función PURA, sin base ni reloj. Una sola decisión de qué sale. Lista de permitidos (todo nace cerrado):
 * un host de MARCA sirve el portal de cualquiera de sus empresas; uno de EMPRESA, solo el de esa empresa; cualquier otro dueño no sirve nada. Previene H-DOM-1 (el
 * host dedicado de una empresa servía lo de otra de la misma marca). Devuelve `null` si no se sirve, con la misma respuesta para todos los motivos (sin oráculo).
 * Solo salen las tarjetas y zonas visibles de una sucursal con su carta EN LÍNEA (lo decide la base con sus políticas y esta función lo vuelve a exigir). Nada se guarda
 * entre visitas.
 */
export function armarPortalPublicado(
  leido: PortalLeido,
  host: AlcanceDelHost,
): PortalPublicado | null {
  if (leido.marcaId !== host.marcaId) return null;
  const duenio = host.duenio;
  const loSirve =
    duenio.tipo === "MARCA" || (duenio.tipo === "EMPRESA" && duenio.empresaId === leido.empresaId);
  if (!loSirve) return null;
  if (!puedeOperar(estadoEfectivo(leido.estadoDelTenant, leido.estadoDeLaEmpresa))) return null;

  const abiertas = new Set(leido.sucursalesAbiertas);
  const cartaDe = new Map(
    leido.cartas.filter((c) => abiertas.has(c.sucursalId)).map((c) => [c.sucursalId, c]),
  );
  return {
    codigo: leido.codigo,
    variante: leido.datos.variante,
    lineaSuperior: leido.datos.lineaSuperior,
    titulo: leido.datos.titulo,
    colorEncabezado: leido.datos.colorEncabezado,
    colorPagina: leido.datos.colorPagina,
    colorDetras: leido.datos.colorDetras,
    logoVisible: leido.datos.logoVisible,
    imagen: leido.datos.imagen,
    tarjetas: leido.tarjetas.flatMap((t) => {
      const carta = cartaDe.get(t.sucursalId);
      if (!t.visible || carta === undefined) return [];
      return [
        {
          orden: t.orden,
          nombre: t.nombre ?? carta.nombre,
          telefono: t.telefono,
          foto: t.foto,
          codigoDeCarta: carta.codigo,
        },
      ];
    }),
    zonas: leido.zonas.flatMap((z) => {
      const carta = cartaDe.get(z.sucursalId);
      if (!z.visible || carta === undefined) return [];
      return [
        {
          x: textoDesdeCentesimas(z.x),
          y: textoDesdeCentesimas(z.y),
          ancho: textoDesdeCentesimas(z.ancho),
          alto: textoDesdeCentesimas(z.alto),
          codigoDeCarta: carta.codigo,
        },
      ];
    }),
  };
}
