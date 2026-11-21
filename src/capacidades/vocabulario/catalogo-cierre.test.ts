import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS } from "./catalogo";
import { TEXTOS_DE_CIERRE } from "./catalogo-cierre";

/**
 * Los textos de «Cierre del día»: uno por uno, tal cual los aprobó el dueño (14/11/2026, filas 123 y 126 de `decisiones-del-dueno-2026-11.md`; «Siguiente», 15/11/2026, fila 183) y la maqueta
 * aceptada. Un texto aprobado no cambia sin romper esta prueba. Previene: que alguien «mejore» una redacción del cierre sin que el dueño la haya visto.
 */
describe("catalogo-cierre: los textos aprobados, exactamente", () => {
  it("cada clave con su texto", () => {
    expect(
      Object.fromEntries(Object.entries(TEXTOS_DE_CIERRE).map(([k, v]) => [k, v.porDefecto])),
    ).toEqual({
      "cierre.titulo": "Cierre del día",
      "cierre.jornada": "Jornada",
      "cierre.estado.abierta": "Abierta",
      "cierre.estado.en_auditoria": "En cierre",
      "cierre.estado.cerrada": "Cerrada",
      "cierre.accion.iniciar": "Empezar el cierre",
      "cierre.accion.cerrar": "Cerrar el día",
      "cierre.accion.cancelar": "Cancelar cierre",
      "cierre.accion.siguiente": "Siguiente",
      "cierre.accion.volver": "Volver",
      "cierre.severidad.bloquea": "Impide cerrar",
      "cierre.severidad.reconocible": "Hay que reconocer",
      "cierre.severidad.informa": "Solo informa",
      "cierre.control.sesiones_sin_cerrar": "Cajas sin cerrar",
      "cierre.control.cuentas_abiertas": "Cuentas abiertas sin cobrar",
      "cierre.control.diferencia_de_arqueo": "Diferencias de arqueo",
      "cierre.control.conciliacion_por_medio": "Conciliación por medio",
      "cierre.control.cobrado_contra_ticket": "Cobrado contra el ticket",
      "cierre.control.tickets_por_cobrar": "Tickets por cobrar",
      "cierre.control.cortesias": "Cortesías",
      "cierre.control.anulaciones": "Anulaciones",
      "cierre.control.correcciones": "Correcciones",
      "cierre.control.pendientes_de_facturar": "Pendientes de facturar",
      "cierre.control.cobros_corregidos": "Cobros corregidos",
      "cierre.control.ajustes_a_jornadas_cerradas": "Ajustes de días cerrados",
      "cierre.reconocer": "Reconocer",
      "cierre.observacion_opcional": "Observación (opcional)",
      "cierre.reconocido_por": "Reconocido por {persona} · {cuando}",
      "cierre.cerrada_por": "{persona} · {cuando}",
      "cierre.conciliacion.registrado": "Registrado",
      "cierre.conciliacion.correcciones": "Correcciones",
      "cierre.conciliacion.declarado": "Declarado",
      "cierre.conciliacion.diferencia": "Diferencia",
      "cierre.conciliacion.conforme": "Conforme",
      "cierre.conciliacion.sin_dato": "Sin declarar",
      "cierre.conforme_general": "Conforme general",
      "cierre.cobros": "Cobros",
      "cierre.corregir_medio": "Corregir medio",
      "cierre.medio_correcto": "Medio correcto",
      "cierre.cuenta_de_cobro": "Cuenta de cobro",
      "cierre.sin_cuenta": "Sin cuenta",
      "cierre.motivo": "Motivo",
      "cierre.corregido_por": "Corregido por {persona} · {cuando}",
      "cierre.ticket_numero": "Ticket {numero}",
      "cierre.error.accion_no_permitida": "Esta acción no está permitida",
      "cierre.error.controles_cambiaron": "Cambió algo mientras mirabas. Revisá y volvé a cerrar",
    });
  });

  it("los textos con datos declaran sus marcadores, y el largo máximo de los que se arman con una persona", () => {
    const con = Object.entries(TEXTOS_DE_CIERRE).filter(([, v]) => "marcadores" in v);
    expect(
      Object.fromEntries(con.map(([k, v]) => [k, "marcadores" in v ? v.marcadores : []])),
    ).toEqual({
      "cierre.reconocido_por": ["persona", "cuando"],
      "cierre.cerrada_por": ["persona", "cuando"],
      "cierre.corregido_por": ["persona", "cuando"],
      "cierre.ticket_numero": ["numero"],
    });
    for (const clave of [
      "cierre.reconocido_por",
      "cierre.cerrada_por",
      "cierre.corregido_por",
    ] as const) {
      expect(TEXTOS_DE_CIERRE[clave].largoMaximo).toBe(120);
    }
    expect(TEXTOS_DE_CIERRE["cierre.error.controles_cambiaron"].largoMaximo).toBe(120);
  });

  it("están todos en el catálogo general y ninguno repite el de otro módulo bajo su misma clave", () => {
    for (const clave of Object.keys(TEXTOS_DE_CIERRE)) {
      expect(Object.hasOwn(CATALOGO_DE_TEXTOS, clave), clave).toBe(true);
      expect(clave.startsWith("cierre."), clave).toBe(true);
    }
  });
});
