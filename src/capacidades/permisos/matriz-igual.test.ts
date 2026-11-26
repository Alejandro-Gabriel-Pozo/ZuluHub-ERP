import { describe, expect, it } from "vitest";
import { clavesDe, estadoDeModulos } from "../modulos/activos";
import { CATALOGO_DE_MODULOS, type ClaveAccion } from "../modulos/catalogo";
import {
  PERMISOS_DE_EMPRESA,
  REGLAS_DE_EMPRESA,
  tablaDePermisos,
  type ReglasDeEmpresa,
} from "./empresa";
import { evaluarGuard } from "./guard";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "./roles";

/**
 * Dato congelado: la matriz rol → acciones de la empresa, fila por fila y en el orden de `empresa.ts`, tomada de `main`
 * (628f15e) ANTES de partirla en un archivo por módulo (E-4). La lista de roles de cada fila va en su orden. Se generó con un
 * comando sobre el código sin tocar (no a mano) y no se edita: si una acción cambia de roles a propósito, es una decisión
 * del dueño y esta prueba se rehace aparte. Previene: una acción que pierde o gana un permiso al mudar de archivo (quien no
 * debía entrar, entra).
 */
const MATRIZ_CONGELADA: readonly (readonly [string, readonly RolDeEmpresa[]])[] = [
  ["usuarios.invitar", ["GERENTE", "ADMINISTRADOR"]],
  ["usuarios.reenviar_invitacion", ["GERENTE", "ADMINISTRADOR"]],
  ["usuarios.apagar", ["GERENTE", "ADMINISTRADOR"]],
  ["usuarios.ver", ["GERENTE", "ADMINISTRADOR"]],
  ["usuarios.asignar_sucursales", ["GERENTE", "ADMINISTRADOR"]],
  ["usuarios.revocar_invitacion", ["GERENTE", "ADMINISTRADOR"]],
  ["sucursales.ver", ["GERENTE", "ADMINISTRADOR"]],
  ["sucursales.crear", ["GERENTE", "ADMINISTRADOR"]],
  ["sucursales.editar", ["GERENTE", "ADMINISTRADOR"]],
  ["sucursales.desactivar", ["GERENTE"]],
  ["sucursales.reactivar", ["GERENTE"]],
  ["gerencia.proponer_traspaso", ["GERENTE"]],
  ["gerencia.cancelar_traspaso", ["GERENTE"]],
  ["gerencia.ver_traspaso", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["gerencia.aceptar_traspaso", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["gerencia.rechazar_traspaso", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["modulos.ver", ["GERENTE", "ADMINISTRADOR"]],
  ["permisos.ver_propios", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["datos_fiscales.editar", ["GERENTE"]],
  ["datos_fiscales.confirmar", ["GERENTE"]],
  ["puntos_de_venta.crear", ["GERENTE"]],
  ["puntos_de_venta.editar", ["GERENTE"]],
  ["puntos_de_venta.activar", ["GERENTE"]],
  ["puntos_de_venta.desactivar", ["GERENTE"]],
  ["emisores.confirmar_regla", ["GERENTE"]],
  ["comprobantes.emitir", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["comprobantes.ver", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["productos.ver", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["vidrieras.ver", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["stock.ver", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["vidrieras.marcar_disponibilidad", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["stock.registrar_entrada", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["stock.registrar_salida", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["stock.transferir", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["conteos.registrar", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["productos.crear", ["GERENTE", "ADMINISTRADOR"]],
  ["productos.editar", ["GERENTE", "ADMINISTRADOR"]],
  ["productos.reactivar", ["GERENTE", "ADMINISTRADOR"]],
  ["productos.cambiar_precio", ["GERENTE", "ADMINISTRADOR"]],
  ["opciones.editar", ["GERENTE", "ADMINISTRADOR"]],
  ["productos.desactivar", ["GERENTE", "ADMINISTRADOR"]],
  ["vidrieras.crear", ["GERENTE", "ADMINISTRADOR"]],
  ["vidrieras.editar", ["GERENTE", "ADMINISTRADOR"]],
  ["vidrieras.ocultar_en_empresa", ["GERENTE", "ADMINISTRADOR"]],
  ["vidrieras.publicar", ["GERENTE", "ADMINISTRADOR"]],
  ["vidrieras.retirar", ["GERENTE", "ADMINISTRADOR"]],
  ["depositos.crear", ["GERENTE", "ADMINISTRADOR"]],
  ["depositos.editar", ["GERENTE", "ADMINISTRADOR"]],
  ["depositos.reactivar", ["GERENTE", "ADMINISTRADOR"]],
  ["articulos.controlar", ["GERENTE", "ADMINISTRADOR"]],
  ["composiciones.editar", ["GERENTE", "ADMINISTRADOR"]],
  ["lotes.ver", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["lotes.controlar", ["GERENTE", "ADMINISTRADOR"]],
  ["lotes.dejar_de_controlar", ["GERENTE", "ADMINISTRADOR"]],
  ["lotes.cambiar_calidad", ["GERENTE", "ADMINISTRADOR"]],
  ["lotes.corregir", ["GERENTE", "ADMINISTRADOR"]],
  ["lotes.reasignar", ["GERENTE", "ADMINISTRADOR"]],
  ["transformaciones.ver", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["transformaciones.abrir", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["transformaciones.cerrar", ["GERENTE", "ADMINISTRADOR"]],
  ["transformaciones.cancelar", ["GERENTE", "ADMINISTRADOR"]],
  ["transformaciones.anular", ["GERENTE", "ADMINISTRADOR"]],
  ["depositos.desactivar", ["GERENTE", "ADMINISTRADOR"]],
  ["articulos.dejar_de_controlar", ["GERENTE", "ADMINISTRADOR"]],
  ["stock.ajustar", ["GERENTE", "ADMINISTRADOR"]],
  ["conteos.abrir", ["GERENTE", "ADMINISTRADOR"]],
  ["stock.anular", ["GERENTE", "ADMINISTRADOR"]],
  ["conteos.aplicar", ["GERENTE", "ADMINISTRADOR"]],
  ["conteos.cancelar", ["GERENTE", "ADMINISTRADOR"]],
  ["vidrieras.publicar_en_linea", ["GERENTE", "ADMINISTRADOR"]],
  ["vidrieras.renovar_enlace", ["GERENTE", "ADMINISTRADOR"]],
  ["vidrieras.retirar_de_linea", ["GERENTE", "ADMINISTRADOR"]],
  ["vidrieras.administrar_portal", ["GERENTE", "ADMINISTRADOR"]],
  ["vidrieras.administrar_cuentas_de_imagen", ["GERENTE", "ADMINISTRADOR"]],
  ["stock.verificar_saldos", ["GERENTE"]],
  ["costos.ver", ["GERENTE", "ADMINISTRADOR"]],
  ["variantes.editar", ["GERENTE", "ADMINISTRADOR"]],
  ["comprobantes.emitir_manual", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["notas_de_credito.emitir", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["comprobantes.descartar", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["comprobantes.reintentar", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["series.resincronizar", ["GERENTE"]],
  ["puntos_de_venta.cambiar_ambiente", ["GERENTE"]],
  ["certificados.gestionar", ["GERENTE"]],
  ["cajas.ver", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["cajas.crear", ["GERENTE"]],
  ["cajas.reactivar", ["GERENTE"]],
  ["cajas.desactivar", ["GERENTE"]],
  ["cajas.editar", ["GERENTE", "ADMINISTRADOR"]],
  ["medios_de_pago.crear", ["GERENTE", "ADMINISTRADOR"]],
  ["medios_de_pago.editar", ["GERENTE", "ADMINISTRADOR"]],
  ["medios_de_pago.reactivar", ["GERENTE", "ADMINISTRADOR"]],
  ["medios_de_pago.desactivar", ["GERENTE", "ADMINISTRADOR"]],
  ["cuentas_de_cobro.crear", ["GERENTE", "ADMINISTRADOR"]],
  ["cuentas_de_cobro.editar", ["GERENTE", "ADMINISTRADOR"]],
  ["cuentas_de_cobro.reactivar", ["GERENTE", "ADMINISTRADOR"]],
  ["cuentas_de_cobro.desactivar", ["GERENTE", "ADMINISTRADOR"]],
  ["sesiones_caja.abrir", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["sesiones_caja.iniciar_cierre", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["sesiones_caja.cancelar_cierre", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["sesiones_caja.cerrar", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["movimientos_caja.registrar_manual", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["movimientos_caja.ajustar", ["GERENTE", "ADMINISTRADOR"]],
  ["movimientos_caja.anular", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["movimientos_caja.anular_de_otros", ["GERENTE", "ADMINISTRADOR"]],
  ["cobros.corregir_medio", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["declaraciones_de_total.registrar", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["jornadas.ver", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["jornadas.iniciar_auditoria", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["jornadas.cancelar_auditoria", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["jornadas.cerrar", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["ventas.ver", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["cuentas.abrir", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["cuentas.agregar_linea", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["cuentas.cerrar", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["cuentas.anular_linea", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["cuentas.anular", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["tickets.cobrar", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["tickets.corregir", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["mesas.ver", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["mesas.crear", ["GERENTE", "ADMINISTRADOR"]],
  ["mesas.editar", ["GERENTE", "ADMINISTRADOR"]],
  ["mesas.reactivar", ["GERENTE", "ADMINISTRADOR"]],
  ["mesas.desactivar", ["GERENTE", "ADMINISTRADOR"]],
  ["salon.cambiar_mesa", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["salon.unir", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["salon.dividir", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["comandas.ver", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["comandas.enviar", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["impresiones.imprimir", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["impresiones.reimprimir", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["impresoras.ver", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["impresoras.crear", ["GERENTE", "ADMINISTRADOR"]],
  ["impresoras.editar", ["GERENTE", "ADMINISTRADOR"]],
  ["impresoras.desactivar", ["GERENTE", "ADMINISTRADOR"]],
  ["partes.ver", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["partes.crear", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["partes.editar", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["partes.cambiar_roles", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["partes.vincular_contacto", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["partes.desvincular_contacto", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["partes.desactivar", ["GERENTE", "ADMINISTRADOR"]],
  ["partes.reactivar", ["GERENTE", "ADMINISTRADOR"]],
  ["partes.anonimizar", ["GERENTE"]],
  ["proveedores.editar_ficha", ["GERENTE", "ADMINISTRADOR"]],
  ["proveedores.pedir_ficha", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["recepciones.ver", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["recepciones.registrar", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["recepciones.anular", ["GERENTE", "ADMINISTRADOR"]],
  ["recepciones.confirmar", ["GERENTE", "ADMINISTRADOR"]],
  ["comprobantes_de_proveedor.anular", ["GERENTE", "ADMINISTRADOR"]],
  ["conciliaciones.ver", ["GERENTE", "ADMINISTRADOR"]],
  ["conciliaciones.conciliar", ["GERENTE", "ADMINISTRADOR"]],
  ["conciliaciones.anular", ["GERENTE", "ADMINISTRADOR"]],
  ["comprobantes_de_proveedor.ver", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["comprobantes_de_proveedor.registrar", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["comprobantes_de_proveedor.pagar", ["GERENTE", "ADMINISTRADOR"]],
  ["comprobantes_de_proveedor.anular_pago", ["GERENTE", "ADMINISTRADOR"]],
  ["ordenes_de_compra.ver", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["ordenes_de_compra.crear", ["GERENTE", "ADMINISTRADOR"]],
  ["ordenes_de_compra.pedir", ["GERENTE", "ADMINISTRADOR"]],
  ["ordenes_de_compra.cerrar", ["GERENTE", "ADMINISTRADOR"]],
  ["ordenes_de_compra.anular", ["GERENTE", "ADMINISTRADOR"]],
  ["devoluciones_a_proveedor.ver", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["devoluciones_a_proveedor.registrar", ["GERENTE", "ADMINISTRADOR"]],
  ["devoluciones_a_proveedor.anular", ["GERENTE", "ADMINISTRADOR"]],
  ["notas_de_credito_de_proveedor.ver", ["GERENTE", "ADMINISTRADOR", "OPERADOR"]],
  ["notas_de_credito_de_proveedor.registrar", ["GERENTE", "ADMINISTRADOR"]],
  ["notas_de_credito_de_proveedor.anular", ["GERENTE", "ADMINISTRADOR"]],
  ["diferencias_de_compra.ver", ["GERENTE", "ADMINISTRADOR"]],
  ["diferencias_de_compra.resolver", ["GERENTE", "ADMINISTRADOR"]],
  ["compras.configurar", ["GERENTE"]],
  ["compras.corregir", ["GERENTE", "ADMINISTRADOR"]],
  ["compras.exportar", ["GERENTE", "ADMINISTRADOR"]],
  ["roles.ver", ["GERENTE"]],
  ["roles.crear", ["GERENTE"]],
  ["roles.editar", ["GERENTE"]],
  ["roles.archivar", ["GERENTE"]],
  ["cuenta_corriente.ver", ["GERENTE", "ADMINISTRADOR"]],
  ["cuenta_corriente.administrar", ["GERENTE", "ADMINISTRADOR"]],
];

/** Cifras del congelado: filas, y cuántas acciones puede cada rol. */
const FILAS = 180;
const PUEDEN = { GERENTE: 180, ADMINISTRADOR: 156, OPERADOR: 65 } as const satisfies Record<
  RolDeEmpresa,
  number
>;

const CONGELADA = new Map<string, readonly RolDeEmpresa[]>(MATRIZ_CONGELADA);

/** La matriz congelada como `Record`, para armar unas reglas con ella (las claves son las del dato). */
const PERMISOS_CONGELADOS = Object.fromEntries(MATRIZ_CONGELADA) as Record<
  ClaveAccion,
  readonly RolDeEmpresa[]
>;

function rolesVivos(accion: string): readonly RolDeEmpresa[] {
  const fila = Object.entries(PERMISOS_DE_EMPRESA).find(([a]) => a === accion);
  return fila === undefined ? [] : fila[1];
}

describe("el dato congelado", () => {
  it("tiene las cifras que se anotaron al congelarlo", () => {
    expect(MATRIZ_CONGELADA).toHaveLength(FILAS);
    expect(CONGELADA.size).toBe(FILAS);
    for (const rol of ROLES_DE_EMPRESA) {
      expect(MATRIZ_CONGELADA.filter(([, roles]) => roles.includes(rol))).toHaveLength(PUEDEN[rol]);
    }
  });
});

describe("la matriz de permisos de la empresa es idéntica a la congelada", () => {
  it("tiene exactamente las mismas acciones: ni una más, ni una menos", () => {
    expect([...clavesDe(PERMISOS_DE_EMPRESA)].sort()).toEqual([...CONGELADA.keys()].sort());
  });

  it("cada fila tiene la misma lista de roles, elemento por elemento y en el mismo orden", () => {
    for (const [accion, roles] of MATRIZ_CONGELADA) {
      expect(rolesVivos(accion), accion).toEqual(roles);
    }
  });

  it("cada acción × cada rol da lo mismo, y se recorren todas las combinaciones", () => {
    let comparadas = 0;
    for (const accion of CONGELADA.keys()) {
      for (const rol of ROLES_DE_EMPRESA) {
        expect(rolesVivos(accion).includes(rol), `${rol} ${accion}`).toBe(
          CONGELADA.get(accion)?.includes(rol),
        );
        comparadas++;
      }
    }
    expect(comparadas).toBe(FILAS * ROLES_DE_EMPRESA.length);
    expect(comparadas).toBe(540);
  });

  it("la tabla leída por rol es la misma", () => {
    expect(tablaDePermisos(PERMISOS_DE_EMPRESA)).toEqual(tablaDePermisos(PERMISOS_CONGELADOS));
  });
});

describe("el guard con las reglas reales decide como con la matriz congelada", () => {
  const todosActivos = new Set(clavesDe(CATALOGO_DE_MODULOS));
  const activosReales = estadoDeModulos(CATALOGO_DE_MODULOS, [], []).modulosActivos;
  /** Sin esto, los módulos `en_desarrollo` rechazarían antes de mirar la matriz y la comparación no probaría nada de sus filas. */
  const todoDisponible: ReglasDeEmpresa["catalogo"] = {
    ...CATALOGO_DE_MODULOS,
    vidriera: { ...CATALOGO_DE_MODULOS.vidriera, estado: "disponible" },
    produccion: { ...CATALOGO_DE_MODULOS.produccion, estado: "disponible" },
    cuenta_corriente: { ...CATALOGO_DE_MODULOS.cuenta_corriente, estado: "disponible" },
  };
  const roles: readonly (RolDeEmpresa | null)[] = [...ROLES_DE_EMPRESA, null];

  it("el catálogo de la comparación no deja ningún módulo cerrado por estar en desarrollo", () => {
    for (const modulo of clavesDe(todoDisponible)) {
      expect(todoDisponible[modulo].estado, modulo).toBe("disponible");
    }
  });

  it("las reglas reales apuntan a la matriz y al catálogo reales", () => {
    expect(REGLAS_DE_EMPRESA.permisos).toBe(PERMISOS_DE_EMPRESA);
    expect(REGLAS_DE_EMPRESA.catalogo).toBe(CATALOGO_DE_MODULOS);
  });

  it("con todos los módulos disponibles y activos: cada acción × (tres roles y sin rol)", () => {
    const vivas: ReglasDeEmpresa = {
      catalogo: todoDisponible,
      permisos: REGLAS_DE_EMPRESA.permisos,
    };
    const congeladas: ReglasDeEmpresa = { catalogo: todoDisponible, permisos: PERMISOS_CONGELADOS };
    let comparadas = 0;
    let permitidas = 0;
    for (const accion of clavesDe(PERMISOS_DE_EMPRESA)) {
      for (const rol of roles) {
        const datos = { rol, modulosActivos: todosActivos, capacidadesDeSucursal: null };
        const resultado = evaluarGuard(vivas, accion, datos);
        expect(resultado, `${String(rol)} ${accion}`).toEqual(
          evaluarGuard(congeladas, accion, datos),
        );
        comparadas++;
        if (resultado.ok) permitidas++;
      }
    }
    expect(comparadas).toBe(FILAS * 4);
    expect(permitidas).toBe(PUEDEN.GERENTE + PUEDEN.ADMINISTRADOR + PUEDEN.OPERADOR);
  });

  it("con el catálogo y los módulos activos reales (los en desarrollo siguen cerrados)", () => {
    const congeladas: ReglasDeEmpresa = {
      catalogo: CATALOGO_DE_MODULOS,
      permisos: PERMISOS_CONGELADOS,
    };
    for (const accion of clavesDe(PERMISOS_DE_EMPRESA)) {
      for (const rol of roles) {
        const datos = { rol, modulosActivos: activosReales, capacidadesDeSucursal: null };
        expect(evaluarGuard(REGLAS_DE_EMPRESA, accion, datos), `${String(rol)} ${accion}`).toEqual(
          evaluarGuard(congeladas, accion, datos),
        );
      }
    }
  });
});
