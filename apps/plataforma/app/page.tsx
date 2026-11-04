import { redirect } from "next/navigation";
import { exigirAcceso } from "../servidor/acceso";

// La consola arranca en Empresas. Sin acceso, `exigirAcceso` manda al ingreso antes de redirigir.
export default async function PaginaDeInicio() {
  await exigirAcceso();
  redirect("/empresas");
}
