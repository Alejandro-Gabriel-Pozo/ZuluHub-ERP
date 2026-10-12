import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  estadoEfectivo,
  type EstadoDeEmpresa,
  type EstadoDeTenant,
  type EstadoEfectivo,
} from "../contexto/estados";
import { empresaId, tenantId } from "../primitivas/identificadores/marca";
import "../../test/propiedades/configuracion";
import {
  armarVistaDeGrupo,
  type EmpresaParaLaVista,
  type TenantParaLaVista,
} from "./vista-de-grupo";

const T1 = tenantId("t-1");
const tenant = (estado: EstadoDeTenant = "ACTIVE"): TenantParaLaVista => ({
  id: T1,
  nombre: "Grupo Uno",
  estado,
});
const empresa = (
  id: string,
  estado: EstadoDeEmpresa = "ACTIVE",
  propias: Partial<EmpresaParaLaVista> = {},
): EmpresaParaLaVista => ({
  id: empresaId(id),
  tenantId: T1,
  razonSocial: `Razón ${id}`,
  cuit: "20123456786",
  estado,
  ...propias,
});

describe("armarVistaDeGrupo", () => {
  it("un tenant sin empresas da una lista vacía, con el nombre y el estado del tenant", () => {
    expect(armarVistaDeGrupo(tenant(), [])).toEqual({
      tenant: { nombre: "Grupo Uno", estado: "ACTIVE" },
      empresas: [],
    });
  });

  it("devuelve cada empresa con su razón social, su CUIT, su estado y su estado efectivo, y nada más", () => {
    const vista = armarVistaDeGrupo(tenant(), [
      empresa("e-1", "ACTIVE", { cuit: "30111111118", razonSocial: "Alfa SA" }),
      empresa("e-2", "SUSPENDED", { cuit: "30222222229", razonSocial: "Beta SRL" }),
    ]);
    expect(vista).toEqual({
      tenant: { nombre: "Grupo Uno", estado: "ACTIVE" },
      empresas: [
        {
          id: "e-1",
          razonSocial: "Alfa SA",
          cuit: "30111111118",
          estado: "ACTIVE",
          estadoEfectivo: "OPERA",
        },
        {
          id: "e-2",
          razonSocial: "Beta SRL",
          cuit: "30222222229",
          estado: "SUSPENDED",
          estadoEfectivo: "EMPRESA_SUSPENDIDA",
        },
      ],
    });
  });

  it("no expone campos que la pantalla no necesita (el motivo, la versión, la zona horaria ni el id del tenant)", () => {
    const conDemas = {
      ...empresa("e-1"),
      motivoEstado: "revisión",
      version: 7,
      zonaHoraria: "America/Argentina/Buenos_Aires",
    };
    const tenantConDemas = { ...tenant(), motivoEstado: "x", version: 3 };
    const [fila] = armarVistaDeGrupo(tenantConDemas, [conDemas]).empresas;
    expect(Object.keys(fila ?? {}).sort()).toEqual([
      "cuit",
      "estado",
      "estadoEfectivo",
      "id",
      "razonSocial",
    ]);
    expect(Object.keys(armarVistaDeGrupo(tenantConDemas, []).tenant).sort()).toEqual([
      "estado",
      "nombre",
    ]);
  });

  it("mantiene el orden en que llegan las empresas (la consulta ya las pide ordenadas)", () => {
    const vista = armarVistaDeGrupo(tenant(), [empresa("e-9"), empresa("e-1"), empresa("e-5")]);
    expect(vista.empresas.map((e) => e.id)).toEqual(["e-9", "e-1", "e-5"]);
  });

  it("con el tenant suspendido muestra la lista y los estados: las que estaban activas figuran como TENANT_SUSPENDIDO", () => {
    const vista = armarVistaDeGrupo(tenant("SUSPENDED"), [
      empresa("e-1", "ACTIVE"),
      empresa("e-2", "SUSPENDED"),
      empresa("e-3", "PROVISIONING"),
      empresa("e-4", "CANCELLED"),
      empresa("e-5", "DELETING"),
    ]);
    expect(vista.tenant).toEqual({ nombre: "Grupo Uno", estado: "SUSPENDED" });
    expect(vista.empresas.map((e) => [e.estado, e.estadoEfectivo])).toEqual([
      ["ACTIVE", "TENANT_SUSPENDIDO"],
      ["SUSPENDED", "TENANT_SUSPENDIDO"],
      ["PROVISIONING", "TENANT_SUSPENDIDO"],
      ["CANCELLED", "EMPRESA_CANCELADA"],
      ["DELETING", "EMPRESA_EN_BAJA"],
    ]);
  });

  it("con el tenant activo, cada estado de empresa tiene su estado efectivo", () => {
    const vista = armarVistaDeGrupo(tenant(), [
      empresa("e-1", "ACTIVE"),
      empresa("e-2", "SUSPENDED"),
      empresa("e-3", "PROVISIONING"),
      empresa("e-4", "CANCELLED"),
      empresa("e-5", "DELETING"),
    ]);
    expect(vista.empresas.map((e) => e.estadoEfectivo)).toEqual([
      "OPERA",
      "EMPRESA_SUSPENDIDA",
      "EMPRESA_EN_ALTA",
      "EMPRESA_CANCELADA",
      "EMPRESA_EN_BAJA",
    ]);
  });

  it("una empresa de OTRO tenant en la lista falla cerrado: no se muestra", () => {
    const ajena = empresa("e-2", "ACTIVE", { tenantId: tenantId("t-2") });
    expect(() => armarVistaDeGrupo(tenant(), [empresa("e-1"), ajena])).toThrow(
      new RangeError("la empresa e-2 no es del tenant t-1"),
    );
    expect(() => armarVistaDeGrupo(tenant(), [ajena])).toThrow(RangeError);
  });

  it("no modifica lo que recibe", () => {
    const empresas = [empresa("e-2"), empresa("e-1")];
    const copia = structuredClone(empresas);
    armarVistaDeGrupo(tenant(), empresas);
    expect(empresas).toEqual(copia);
  });
});

describe("armarVistaDeGrupo (propiedades)", () => {
  const estadoDeTenant = fc.constantFrom<EstadoDeTenant>("ACTIVE", "SUSPENDED");
  const estadoDeEmpresa = fc.constantFrom<EstadoDeEmpresa>(
    "PROVISIONING",
    "ACTIVE",
    "SUSPENDED",
    "CANCELLED",
    "DELETING",
  );
  const empresas = fc.array(
    fc.record({
      id: fc.uuid().map(empresaId),
      razonSocial: fc.string({ minLength: 1 }),
      cuit: fc.stringMatching(/^[0-9]{11}$/),
      estado: estadoDeEmpresa,
    }),
    { maxLength: 12 },
  );

  it("conserva la cantidad, el orden y los datos de cada empresa, y su estado efectivo es el que combina tenant y empresa", () => {
    fc.assert(
      fc.property(estadoDeTenant, empresas, (estado, lista) => {
        const vista = armarVistaDeGrupo(
          tenant(estado),
          lista.map((e) => ({ ...e, tenantId: T1 })),
        );
        expect(vista.tenant.estado).toBe(estado);
        expect(vista.empresas).toHaveLength(lista.length);
        vista.empresas.forEach((fila, i) => {
          const origen = lista[i];
          expect(fila).toEqual({
            id: origen?.id,
            razonSocial: origen?.razonSocial,
            cuit: origen?.cuit,
            estado: origen?.estado,
            estadoEfectivo: estadoEfectivo(estado, origen?.estado ?? "ACTIVE"),
          });
        });
      }),
    );
  });

  it("una empresa pierde su condición de OPERA si y solo si el tenant está suspendido o ella no está activa", () => {
    fc.assert(
      fc.property(estadoDeTenant, estadoDeEmpresa, (t, e) => {
        const [fila] = armarVistaDeGrupo(tenant(t), [empresa("e-1", e)]).empresas;
        const efectivo: EstadoEfectivo | undefined = fila?.estadoEfectivo;
        expect(efectivo === "OPERA").toBe(t === "ACTIVE" && e === "ACTIVE");
      }),
    );
  });
});
