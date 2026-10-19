import { describe, expect, it } from "vitest";
import type { EstadoDeEmpresa } from "../../contexto/estados";
import type { Empresa } from "../../modulos/empresas/publico";
import type { Cuit } from "../../primitivas/identificacion-fiscal/cuit";
import { empresaId, tenantId } from "../../primitivas/identificadores/marca";
import { decidirReactivacionDeEmpresa } from "./ciclo-de-vida";

const empresa = (estado: EstadoDeEmpresa): Empresa => ({
  id: empresaId("e-1"),
  tenantId: tenantId("t-1"),
  cuit: "30703088534" as Cuit,
  razonSocial: "ACME SA",
  estado,
  motivoEstado: estado === "SUSPENDED" ? "mora" : null,
  zonaHoraria: "America/Argentina/Buenos_Aires",
  version: 2,
});

describe("decidirReactivacionDeEmpresa", () => {
  it("una empresa suspendida vuelve a ACTIVE y se le borra el motivo", () => {
    expect(decidirReactivacionDeEmpresa(empresa("SUSPENDED"))).toEqual({
      ok: true,
      valor: { estado: "ACTIVE", motivoEstado: null },
    });
  });

  it("cualquier otro estado es TRANSICION_NO_PERMITIDA, también un alta en curso (no se la activa desde acá)", () => {
    const otros: EstadoDeEmpresa[] = ["PROVISIONING", "ACTIVE", "CANCELLED", "DELETING"];
    for (const estado of otros) {
      expect(decidirReactivacionDeEmpresa(empresa(estado)), estado).toEqual({
        ok: false,
        error: "TRANSICION_NO_PERMITIDA",
      });
    }
  });
});
