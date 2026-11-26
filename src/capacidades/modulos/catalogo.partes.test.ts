import { describe, expect, expectTypeOf, it } from "vitest";
import { CATALOGO_DE_MODULOS, type ClaveAccion } from "./catalogo";
import { MODULO_DE_ADMINISTRACION } from "./catalogo-administracion";
import { MODULO_DE_CAJA } from "./catalogo-caja";
import { MODULO_DE_CATALOGO } from "./catalogo-catalogo";
import { MODULO_DE_CIERRE } from "./catalogo-cierre";
import { MODULO_DE_CLIENTES } from "./catalogo-clientes";
import { MODULO_DE_FACTURACION } from "./catalogo-facturacion";
import { MODULO_DE_STOCK } from "./catalogo-stock";
import { MODULO_DE_VENTAS } from "./catalogo-ventas";
import { MODULO_DE_VIDRIERA } from "./catalogo-vidriera";

/**
 * Dato congelado: `CATALOGO_DE_MODULOS` serializado antes de partir `catalogo.ts` en un archivo por módulo (E-3).
 * Se generó con un comando sobre el código sin tocar; no se edita a mano. Previene: una acción, un efecto, un `requiere`
 * o un estado cambiado, perdido o reordenado al mudar un módulo de archivo (la igualdad incluye el orden de las claves).
 */
const CATALOGO_CONGELADO =
  '{"administracion":{"estado":"disponible","obligatorio":true,"requiere":[],"usaSiExiste":[],"datosRequeridos":[],"implementadoPor":["modulos/identidad","modulos/empresas","modulos/fiscal"],"acciones":{"usuarios.invitar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"usuarios.reenviar_invitacion":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"usuarios.apagar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"usuarios.ver":{"capacidad":null,"efecto":"LECTURA"},"usuarios.asignar_sucursales":{"capacidad":null,"efecto":"CREA_AMPLIA"},"usuarios.revocar_invitacion":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"roles.ver":{"capacidad":null,"efecto":"LECTURA"},"roles.crear":{"capacidad":null,"efecto":"CREA_AMPLIA"},"roles.editar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"roles.archivar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"sucursales.ver":{"capacidad":null,"efecto":"LECTURA"},"sucursales.crear":{"capacidad":null,"efecto":"CREA_AMPLIA"},"sucursales.editar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"sucursales.desactivar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"sucursales.reactivar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"gerencia.proponer_traspaso":{"capacidad":null,"efecto":"CREA_AMPLIA"},"gerencia.cancelar_traspaso":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"gerencia.ver_traspaso":{"capacidad":null,"efecto":"LECTURA"},"gerencia.aceptar_traspaso":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"gerencia.rechazar_traspaso":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"modulos.ver":{"capacidad":null,"efecto":"LECTURA"},"permisos.ver_propios":{"capacidad":null,"efecto":"LECTURA"},"datos_fiscales.editar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"datos_fiscales.confirmar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"puntos_de_venta.crear":{"capacidad":null,"efecto":"CREA_AMPLIA"},"puntos_de_venta.editar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"puntos_de_venta.activar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"puntos_de_venta.desactivar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"emisores.confirmar_regla":{"capacidad":null,"efecto":"CREA_AMPLIA"}}},"facturacion":{"estado":"disponible","obligatorio":false,"requiere":["administracion"],"usaSiExiste":[],"datosRequeridos":["emisor_principal.datos_fiscales_confirmados","punto_de_venta.activo"],"implementadoPor":["modulos/fiscal"],"acciones":{"comprobantes.emitir":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"comprobantes.ver":{"capacidad":null,"efecto":"LECTURA"},"comprobantes.emitir_manual":{"capacidad":null,"efecto":"CREA_AMPLIA"},"notas_de_credito.emitir":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"comprobantes.descartar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"comprobantes.reintentar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"series.resincronizar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"puntos_de_venta.cambiar_ambiente":{"capacidad":null,"efecto":"CREA_AMPLIA"},"certificados.gestionar":{"capacidad":null,"efecto":"CREA_AMPLIA"}}},"catalogo":{"estado":"disponible","obligatorio":false,"requiere":["administracion"],"usaSiExiste":[],"datosRequeridos":[],"implementadoPor":["modulos/catalogo"],"acciones":{"productos.ver":{"capacidad":null,"efecto":"LECTURA"},"productos.crear":{"capacidad":null,"efecto":"CREA_AMPLIA"},"productos.editar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"productos.reactivar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"productos.cambiar_precio":{"capacidad":null,"efecto":"CREA_AMPLIA"},"productos.desactivar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"opciones.editar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"variantes.editar":{"capacidad":null,"efecto":"CREA_AMPLIA"}}},"vidriera":{"estado":"disponible","obligatorio":false,"requiere":["catalogo"],"usaSiExiste":[],"datosRequeridos":[],"implementadoPor":["modulos/catalogo"],"acciones":{"vidrieras.ver":{"capacidad":null,"efecto":"LECTURA"},"vidrieras.marcar_disponibilidad":{"capacidad":null,"efecto":"CREA_AMPLIA"},"vidrieras.ocultar_en_empresa":{"capacidad":null,"efecto":"CREA_AMPLIA"},"vidrieras.crear":{"capacidad":null,"efecto":"CREA_AMPLIA"},"vidrieras.editar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"vidrieras.publicar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"vidrieras.retirar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"vidrieras.publicar_en_linea":{"capacidad":null,"efecto":"CREA_AMPLIA"},"vidrieras.renovar_enlace":{"capacidad":null,"efecto":"CREA_AMPLIA"},"vidrieras.retirar_de_linea":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"vidrieras.administrar_portal":{"capacidad":null,"efecto":"CREA_AMPLIA"}}},"stock":{"estado":"disponible","obligatorio":false,"requiere":["catalogo"],"usaSiExiste":[],"datosRequeridos":[],"implementadoPor":["modulos/stock"],"acciones":{"stock.ver":{"capacidad":null,"efecto":"LECTURA"},"stock.verificar_saldos":{"capacidad":null,"efecto":"LECTURA"},"costos.ver":{"capacidad":null,"efecto":"LECTURA"},"stock.registrar_entrada":{"capacidad":null,"efecto":"CREA_AMPLIA"},"stock.registrar_salida":{"capacidad":null,"efecto":"CREA_AMPLIA"},"stock.transferir":{"capacidad":null,"efecto":"CREA_AMPLIA"},"stock.ajustar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"stock.anular":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"depositos.crear":{"capacidad":null,"efecto":"CREA_AMPLIA"},"depositos.editar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"depositos.reactivar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"depositos.desactivar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"articulos.controlar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"articulos.dejar_de_controlar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"composiciones.editar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"conteos.abrir":{"capacidad":null,"efecto":"CREA_AMPLIA"},"conteos.registrar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"conteos.aplicar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"conteos.cancelar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"lotes.ver":{"capacidad":null,"efecto":"LECTURA"},"lotes.controlar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"lotes.dejar_de_controlar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"lotes.cambiar_calidad":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"lotes.corregir":{"capacidad":null,"efecto":"CREA_AMPLIA"},"lotes.reasignar":{"capacidad":null,"efecto":"CREA_AMPLIA"}}},"caja":{"estado":"disponible","obligatorio":false,"requiere":["administracion"],"usaSiExiste":["facturacion"],"datosRequeridos":[],"implementadoPor":["modulos/caja"],"acciones":{"cajas.ver":{"capacidad":null,"efecto":"LECTURA"},"cajas.crear":{"capacidad":null,"efecto":"CREA_AMPLIA"},"cajas.editar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"cajas.reactivar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"cajas.desactivar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"medios_de_pago.crear":{"capacidad":null,"efecto":"CREA_AMPLIA"},"medios_de_pago.editar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"medios_de_pago.reactivar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"medios_de_pago.desactivar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"cuentas_de_cobro.crear":{"capacidad":null,"efecto":"CREA_AMPLIA"},"cuentas_de_cobro.editar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"cuentas_de_cobro.reactivar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"cuentas_de_cobro.desactivar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"sesiones_caja.abrir":{"capacidad":null,"efecto":"CREA_AMPLIA"},"sesiones_caja.iniciar_cierre":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"sesiones_caja.cancelar_cierre":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"sesiones_caja.cerrar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"movimientos_caja.registrar_manual":{"capacidad":null,"efecto":"CREA_AMPLIA"},"movimientos_caja.ajustar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"movimientos_caja.anular":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"movimientos_caja.anular_de_otros":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"cobros.corregir_medio":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"declaraciones_de_total.registrar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"}}},"cierre":{"estado":"disponible","obligatorio":false,"requiere":["administracion"],"usaSiExiste":[],"datosRequeridos":[],"implementadoPor":["modulos/cierre"],"acciones":{"jornadas.ver":{"capacidad":null,"efecto":"LECTURA"},"jornadas.iniciar_auditoria":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"jornadas.cancelar_auditoria":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"jornadas.cerrar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"}}},"ventas":{"estado":"disponible","obligatorio":false,"requiere":["administracion","catalogo","caja"],"usaSiExiste":["facturacion","stock"],"datosRequeridos":[],"implementadoPor":["modulos/ventas"],"acciones":{"ventas.ver":{"capacidad":null,"efecto":"LECTURA"},"cuentas.abrir":{"capacidad":null,"efecto":"CREA_AMPLIA"},"cuentas.agregar_linea":{"capacidad":null,"efecto":"CREA_AMPLIA"},"cuentas.cerrar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"cuentas.anular_linea":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"cuentas.anular":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"tickets.cobrar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"tickets.corregir":{"capacidad":null,"efecto":"COMPLETA_CIERRA"}}},"comandas":{"estado":"disponible","obligatorio":false,"requiere":["ventas"],"usaSiExiste":["stock"],"datosRequeridos":[],"implementadoPor":["modulos/comandas"],"acciones":{"comandas.ver":{"capacidad":null,"efecto":"LECTURA"},"comandas.enviar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"impresiones.imprimir":{"capacidad":null,"efecto":"CREA_AMPLIA"},"impresiones.reimprimir":{"capacidad":null,"efecto":"CREA_AMPLIA"},"impresoras.ver":{"capacidad":null,"efecto":"LECTURA"},"impresoras.crear":{"capacidad":null,"efecto":"CREA_AMPLIA"},"impresoras.editar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"impresoras.desactivar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"}}},"salon":{"estado":"disponible","obligatorio":false,"requiere":["ventas","comandas"],"usaSiExiste":[],"datosRequeridos":[],"implementadoPor":["modulos/salon"],"acciones":{"mesas.ver":{"capacidad":null,"efecto":"LECTURA"},"mesas.crear":{"capacidad":null,"efecto":"CREA_AMPLIA"},"mesas.editar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"mesas.reactivar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"mesas.desactivar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"salon.cambiar_mesa":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"salon.unir":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"salon.dividir":{"capacidad":null,"efecto":"COMPLETA_CIERRA"}}},"clientes":{"estado":"disponible","obligatorio":true,"requiere":["administracion"],"usaSiExiste":[],"datosRequeridos":[],"implementadoPor":["modulos/clientes"],"acciones":{"partes.ver":{"capacidad":null,"efecto":"LECTURA"},"partes.crear":{"capacidad":null,"efecto":"CREA_AMPLIA"},"partes.editar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"partes.cambiar_roles":{"capacidad":null,"efecto":"CREA_AMPLIA"},"partes.vincular_contacto":{"capacidad":null,"efecto":"CREA_AMPLIA"},"partes.desvincular_contacto":{"capacidad":null,"efecto":"CREA_AMPLIA"},"partes.desactivar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"partes.reactivar":{"capacidad":null,"efecto":"CREA_AMPLIA"}}},"compras":{"estado":"disponible","obligatorio":false,"requiere":["administracion","clientes","catalogo"],"usaSiExiste":["stock"],"datosRequeridos":[],"implementadoPor":["modulos/compras"],"acciones":{"proveedores.editar_ficha":{"capacidad":null,"efecto":"CREA_AMPLIA"},"proveedores.pedir_ficha":{"capacidad":null,"efecto":"CREA_AMPLIA"},"recepciones.ver":{"capacidad":null,"efecto":"LECTURA"},"recepciones.registrar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"recepciones.anular":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"recepciones.confirmar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"conciliaciones.ver":{"capacidad":null,"efecto":"LECTURA"},"conciliaciones.conciliar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"conciliaciones.anular":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"comprobantes_de_proveedor.ver":{"capacidad":null,"efecto":"LECTURA"},"comprobantes_de_proveedor.registrar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"comprobantes_de_proveedor.pagar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"comprobantes_de_proveedor.anular":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"comprobantes_de_proveedor.anular_pago":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"ordenes_de_compra.ver":{"capacidad":null,"efecto":"LECTURA"},"ordenes_de_compra.crear":{"capacidad":null,"efecto":"CREA_AMPLIA"},"ordenes_de_compra.pedir":{"capacidad":null,"efecto":"CREA_AMPLIA"},"ordenes_de_compra.cerrar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"ordenes_de_compra.anular":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"devoluciones_a_proveedor.ver":{"capacidad":null,"efecto":"LECTURA"},"devoluciones_a_proveedor.registrar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"devoluciones_a_proveedor.anular":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"notas_de_credito_de_proveedor.ver":{"capacidad":null,"efecto":"LECTURA"},"notas_de_credito_de_proveedor.registrar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"notas_de_credito_de_proveedor.anular":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"diferencias_de_compra.ver":{"capacidad":null,"efecto":"LECTURA"},"diferencias_de_compra.resolver":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"compras.configurar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"compras.corregir":{"capacidad":null,"efecto":"CREA_AMPLIA"},"compras.exportar":{"capacidad":null,"efecto":"LECTURA"}}},"cuenta_corriente":{"estado":"en_desarrollo","obligatorio":false,"requiere":["clientes"],"usaSiExiste":[],"datosRequeridos":[],"implementadoPor":["modulos/cuenta_corriente"],"acciones":{"cuenta_corriente.ver":{"capacidad":null,"efecto":"LECTURA"},"cuenta_corriente.administrar":{"capacidad":null,"efecto":"CREA_AMPLIA"},"cuenta_corriente.cargar_a_cuenta":{"capacidad":null,"efecto":"CREA_AMPLIA"},"cuenta_corriente.aprobar_exceso":{"capacidad":null,"efecto":"CREA_AMPLIA"}}},"produccion":{"estado":"en_desarrollo","obligatorio":false,"requiere":["stock"],"usaSiExiste":["catalogo"],"datosRequeridos":[],"implementadoPor":["modulos/produccion"],"acciones":{"transformaciones.ver":{"capacidad":null,"efecto":"LECTURA"},"transformaciones.abrir":{"capacidad":null,"efecto":"CREA_AMPLIA"},"transformaciones.cerrar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"transformaciones.cancelar":{"capacidad":null,"efecto":"COMPLETA_CIERRA"},"transformaciones.anular":{"capacidad":null,"efecto":"COMPLETA_CIERRA"}}}}';

const FORMA_DE_UN_MODULO = [
  "estado",
  "obligatorio",
  "requiere",
  "usaSiExiste",
  "datosRequeridos",
  "implementadoPor",
  "acciones",
].sort();

/** Los módulos que `catalogo.ts` no escribe adentro: cada uno en su archivo. */
const PARTES: Readonly<Record<string, object>> = {
  administracion: MODULO_DE_ADMINISTRACION,
  facturacion: MODULO_DE_FACTURACION,
  catalogo: MODULO_DE_CATALOGO,
  vidriera: MODULO_DE_VIDRIERA,
  stock: MODULO_DE_STOCK,
  caja: MODULO_DE_CAJA,
  cierre: MODULO_DE_CIERRE,
  ventas: MODULO_DE_VENTAS,
  clientes: MODULO_DE_CLIENTES,
};

/** Las claves de un módulo que no son de la forma de un módulo (vacío si la forma es exacta). */
function problemasDeForma(modulo: object): string[] {
  const claves = Object.keys(modulo).sort();
  return claves.join() === FORMA_DE_UN_MODULO.join()
    ? []
    : [`claves ${claves.join(", ")} en vez de ${FORMA_DE_UN_MODULO.join(", ")}`];
}

/** Las acciones que figuran en más de un módulo. */
function accionesRepetidas(modulos: Readonly<Record<string, { acciones: object }>>): string[] {
  const vistas = new Set<string>();
  const repetidas = new Set<string>();
  for (const modulo of Object.values(modulos)) {
    for (const accion of Object.keys(modulo.acciones)) {
      if (vistas.has(accion)) repetidas.add(accion);
      vistas.add(accion);
    }
  }
  return [...repetidas];
}

describe("el catálogo de módulos partido en archivos", () => {
  it("es idéntico, con el orden de claves, al de antes de partirlo", () => {
    expect(JSON.stringify(CATALOGO_DE_MODULOS)).toBe(CATALOGO_CONGELADO);
  });

  it("cada parte es un solo módulo con la forma de un módulo", () => {
    expect(Object.keys(PARTES)).toHaveLength(9);
    for (const [nombre, modulo] of Object.entries(PARTES)) {
      expect(problemasDeForma(modulo), nombre).toEqual([]);
    }
  });

  it("detecta un módulo de mentira sin acciones", () => {
    expect(problemasDeForma({ estado: "disponible" })).toHaveLength(1);
    expect(problemasDeForma({ ...MODULO_DE_CIERRE, extra: true })).toHaveLength(1);
  });

  it("ninguna acción vive en dos módulos", () => {
    expect(accionesRepetidas(CATALOGO_DE_MODULOS)).toEqual([]);
  });

  it("detecta una acción repetida en dos módulos", () => {
    const repetida = {
      a: { acciones: { "x.ver": 1 } },
      b: { acciones: { "x.ver": 1, "y.ver": 1 } },
    };
    expect(accionesRepetidas(repetida)).toEqual(["x.ver"]);
  });

  it("ClaveAccion sigue cerrada: no se ensancha a cualquier texto", () => {
    expectTypeOf<string>().not.toEqualTypeOf<ClaveAccion>();
    expectTypeOf<"no.existe">().not.toExtend<ClaveAccion>();
    expectTypeOf<"stock.ver">().toExtend<ClaveAccion>();
  });
});
