import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearMundoDeMarca } from "../integracion/marcas-apoyo";
import {
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  incluirEmpresa,
} from "../integracion/fixtures-identidad";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «Usuarios» de Cuenta (tramo U1, solo lectura) de punta a punta en la app REAL construida, con un navegador real y una base real: el gerente entra desde Cuenta → «Usuarios» y ve a la gente de su empresa
 * con su rol («Gerente», «Administrador», «Empleado»), a la desactivada con su texto y las invitaciones con «Vence el …», «Vencida» o «Pendiente»; abre la ficha de una persona; nunca ve a nadie de otra empresa (la
 * ficha de una ajena dice lo mismo que una inexistente). Después la misma persona pasa a ser empleada: la entrada «Usuarios» desaparece de Cuenta y, abriendo la dirección a mano, el servidor responde con el
 * mensaje genérico, sin filas. Lo que esta prueba ve y las de componentes no: la página en el servidor (el permiso y la lectura de la base), la fila del menú y que los componentes no rompan en el navegador.
 */
const base = inject("baseDePruebas");
const CELULAR = { width: 390, height: 844 } as const;
const GENERICO = "Esta acción no está permitida";
const DIA = 86_400_000;

describe.skipIf(base === null)("recorrido de la lista de usuarios", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;
  let miPersona = "";
  let sofia = "";
  let deOtraEmpresa = "";

  const ir = async (ruta: string) => {
    const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
    await pagina.waitForLoadState("networkidle");
    return respuesta;
  };
  const sinViolacionesDeAxe = async () => expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
  const pantallaLimpia = () => expect(vigilante.tomar()).toEqual([]);

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base);
    const c = mundo.mundo.dueno;
    miPersona = (
      await c.query<{ persona_id: string }>(
        "select persona_id from membresia where empresa_id = $1",
        [mundo.empresa],
      )
    ).rows[0]?.persona_id as string;
    const tenant = (
      await c.query<{ tenant_id: string }>("select tenant_id from empresa where id = $1", [
        mundo.empresa,
      ])
    ).rows[0]?.tenant_id as string;
    const sumar = async (email: string, rol: "ADMINISTRADOR" | "OPERADOR", activo = true) => {
      const persona = await crearPersonaDeBase(c, email);
      await crearMembresiaDeBase(c, mundo.empresa, persona.id, rol, activo);
      return persona.id;
    };
    await sumar("diego@lacteos.test", "ADMINISTRADOR");
    sofia = await sumar("sofia@lacteos.test", "OPERADOR");
    await sumar("ana@lacteos.test", "OPERADOR", false);
    const ahora = Date.now();
    for (const [email, rol, vence] of [
      ["julia@lacteos.test", "OPERADOR", ahora + 5 * DIA],
      ["pablo@lacteos.test", "ADMINISTRADOR", ahora - 2 * DIA],
    ] as const) {
      const inv = await crearInvitacionDeBase(c, { tenant, email, venceEn: new Date(vence) });
      await incluirEmpresa(c, inv, mundo.empresa, rol);
    }
    // Otra empresa (otro tenant) con su gente y su invitación: nada de esto tiene que verse.
    const otra = await crearMundoDeMarca(c, { marca: mundo.mundo.marcaA });
    const ajena = await crearPersonaDeBase(c, "ajena@otra-empresa.test");
    await crearMembresiaDeBase(c, otra.empresa, ajena.id, "OPERADOR");
    deOtraEmpresa = ajena.id;
    const invAjena = await crearInvitacionDeBase(c, {
      tenant: otra.tenant,
      email: "invitada@otra-empresa.test",
      venceEn: new Date(ahora + 3 * DIA),
    });
    await incluirEmpresa(c, invAjena, otra.empresa, "OPERADOR");

    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
    await contexto.addCookies([...mundo.cookies]);
    pagina = await contexto.newPage();
    vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
  });
  afterAll(async () => {
    await navegador?.close();
    await mundo?.cerrar();
  });

  it("el gerente entra desde Cuenta → «Usuarios» y ve a su gente y sus invitaciones, sin nada de otra empresa", async () => {
    await ir("/cuenta");
    await pagina.getByRole("link", { name: "Usuarios" }).click();
    await pagina.waitForURL(/\/cuenta\/usuarios$/);
    await pagina.waitForLoadState("networkidle");
    await pagina.getByRole("heading", { name: "Invitaciones" }).waitFor();

    const filas = await pagina
      .getByRole("link", { name: /@lacteos\.test|@prueba\.test|@/ })
      .allInnerTexts();
    const texto = filas.join("\n");
    expect(texto).toContain("diego@lacteos.test Administrador");
    expect(texto).toContain("sofia@lacteos.test Empleado");
    expect(texto).toContain("ana@lacteos.test Empleado Desactivado");
    expect(await pagina.getByText("Gerente", { exact: false }).count()).toBeGreaterThan(0);
    await pagina.getByText("Empleado · Vence el", { exact: false }).first().waitFor();
    expect(await pagina.getByText("Vencida").count()).toBe(1);
    expect(await pagina.getByText("Pendiente").count()).toBe(1);
    expect(await pagina.getByText("ajena@otra-empresa.test").count()).toBe(0);
    expect(await pagina.getByText("invitada@otra-empresa.test").count()).toBe(0);
    expect(
      await pagina.getByRole("button", { name: /Invitar|Desactivar|Reactivar|Guardar/ }).count(),
    ).toBe(0);
    await sinViolacionesDeAxe();
    pantallaLimpia();
  });

  it("la ficha de una persona de la empresa muestra su rol y su estado; la de una de otra empresa dice lo mismo que una que no existe", async () => {
    await ir(`/cuenta/usuarios/${sofia}`);
    await pagina.getByRole("heading", { name: "sofia@lacteos.test" }).waitFor();
    await pagina.getByText("Empleado").first().waitFor();
    await pagina.getByText("Activo").first().waitFor();
    expect(await pagina.getByRole("button").count()).toBe(0);
    await sinViolacionesDeAxe();

    await ir(`/cuenta/usuarios/${deOtraEmpresa}`);
    await pagina.getByText(GENERICO).first().waitFor();
    expect(await pagina.getByText("ajena@otra-empresa.test").count()).toBe(0);
    await ir("/cuenta/usuarios/0b0b0b0b-1111-4222-8333-4444444444ee");
    await pagina.getByText(GENERICO).first().waitFor();
    await ir("/cuenta/usuarios/no-es-un-id");
    await pagina.getByText(GENERICO).first().waitFor();
    pantallaLimpia();
  });

  it("un empleado no tiene la entrada «Usuarios» y, abriendo la dirección a mano, recibe el genérico y ninguna fila", async () => {
    await mundo.mundo.dueno.query(
      "update membresia set rol = 'OPERADOR' where empresa_id = $1 and persona_id = $2",
      [mundo.empresa, miPersona],
    );
    await ir("/cuenta");
    await pagina.getByRole("button", { name: "Cerrar sesión" }).waitFor();
    expect(await pagina.getByRole("link", { name: "Usuarios" }).count()).toBe(0);

    await ir("/cuenta/usuarios");
    await pagina.getByText(GENERICO).first().waitFor();
    expect(await pagina.getByText("@lacteos.test", { exact: false }).count()).toBe(0);
    expect(await pagina.getByRole("heading", { name: "Invitaciones" }).count()).toBe(0);

    await ir(`/cuenta/usuarios/${sofia}`);
    await pagina.getByText(GENERICO).first().waitFor();
    expect(await pagina.getByText("sofia@lacteos.test").count()).toBe(0);
    await sinViolacionesDeAxe();
    pantallaLimpia();
  });
});
