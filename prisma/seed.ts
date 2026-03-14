// ============================================================
// Script de seed para la base de datos del CRM Propyte
// Crea datos iniciales: usuarios, desarrollos, unidades,
// contactos, deals, reglas de comisión, actividades y config.
// ============================================================

import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🏗️  Iniciando seed de la base de datos Propyte CRM...\n");

  // Contraseña por defecto para todos los usuarios
  const defaultPassword = await hash("Propyte2024!", 12);
  console.log("✅ Contraseña hasheada correctamente");

  await prisma.$transaction(async (tx) => {
    // ================================================================
    // 1. USUARIOS
    // ================================================================
    console.log("\n👤 Creando usuarios...");

    // Director
    const felipe = await tx.user.create({
      data: {
        email: "nacho@propyte.com",
        name: "Felipe Luksic",
        role: "DIRECTOR",
        careerLevel: "GERENTE",
        plaza: "PDC",
        passwordHash: defaultPassword,
        phone: "+52 984 100 0001",
        isActive: true,
      },
    });
    console.log(`  - Director: ${felipe.name} (${felipe.email})`);

    // Gerente
    const carlos = await tx.user.create({
      data: {
        email: "gerente@propyte.com",
        name: "Carlos Mendoza",
        role: "GERENTE",
        careerLevel: "GERENTE",
        plaza: "PDC",
        passwordHash: defaultPassword,
        phone: "+52 984 100 0002",
        isActive: true,
      },
    });
    console.log(`  - Gerente: ${carlos.name} (${carlos.email})`);

    // Team Leader 1 - PDC
    const andrea = await tx.user.create({
      data: {
        email: "andrea@propyte.com",
        name: "Andrea García",
        role: "TEAM_LEADER",
        careerLevel: "TEAM_LEADER",
        plaza: "PDC",
        passwordHash: defaultPassword,
        phone: "+52 984 100 0003",
        isActive: true,
      },
    });
    console.log(`  - Team Leader: ${andrea.name} (${andrea.email})`);

    // Team Leader 2 - Tulum
    const roberto = await tx.user.create({
      data: {
        email: "roberto@propyte.com",
        name: "Roberto Sánchez",
        role: "TEAM_LEADER",
        careerLevel: "TEAM_LEADER",
        plaza: "TULUM",
        passwordHash: defaultPassword,
        phone: "+52 984 100 0004",
        isActive: true,
      },
    });
    console.log(`  - Team Leader: ${roberto.name} (${roberto.email})`);

    // Asesor Sr - Equipo de Andrea
    const maria = await tx.user.create({
      data: {
        email: "maria@propyte.com",
        name: "María López",
        role: "ASESOR_SR",
        careerLevel: "SR",
        plaza: "PDC",
        teamLeaderId: andrea.id,
        passwordHash: defaultPassword,
        phone: "+52 984 100 0005",
        isActive: true,
      },
    });
    console.log(`  - Asesor Sr: ${maria.name} (equipo de ${andrea.name})`);

    // Asesor Jr 1 - Equipo de Andrea
    const diego = await tx.user.create({
      data: {
        email: "diego@propyte.com",
        name: "Diego Hernández",
        role: "ASESOR_JR",
        careerLevel: "JR",
        plaza: "PDC",
        teamLeaderId: andrea.id,
        passwordHash: defaultPassword,
        phone: "+52 984 100 0006",
        isActive: true,
      },
    });
    console.log(`  - Asesor Jr: ${diego.name} (equipo de ${andrea.name})`);

    // Asesor Jr 2 - Equipo de Andrea
    const sofia = await tx.user.create({
      data: {
        email: "sofia@propyte.com",
        name: "Sofía Ramírez",
        role: "ASESOR_JR",
        careerLevel: "JR",
        plaza: "PDC",
        teamLeaderId: andrea.id,
        passwordHash: defaultPassword,
        phone: "+52 984 100 0007",
        isActive: true,
      },
    });
    console.log(`  - Asesor Jr: ${sofia.name} (equipo de ${andrea.name})`);

    // Asesor Jr 3 - Equipo de Roberto
    const alejandro = await tx.user.create({
      data: {
        email: "alejandro@propyte.com",
        name: "Alejandro Torres",
        role: "ASESOR_JR",
        careerLevel: "JR",
        plaza: "TULUM",
        teamLeaderId: roberto.id,
        passwordHash: defaultPassword,
        phone: "+52 984 100 0008",
        isActive: true,
      },
    });
    console.log(`  - Asesor Jr: ${alejandro.name} (equipo de ${roberto.name})`);

    // Asesor Jr 4 - Equipo de Roberto
    const valentina = await tx.user.create({
      data: {
        email: "valentina@propyte.com",
        name: "Valentina Cruz",
        role: "ASESOR_JR",
        careerLevel: "JR",
        plaza: "TULUM",
        teamLeaderId: roberto.id,
        passwordHash: defaultPassword,
        phone: "+52 984 100 0009",
        isActive: true,
      },
    });
    console.log(`  - Asesor Jr: ${valentina.name} (equipo de ${roberto.name})`);

    // Hostess
    const paola = await tx.user.create({
      data: {
        email: "paola@propyte.com",
        name: "Paola Ruiz",
        role: "HOSTESS",
        careerLevel: "JR",
        plaza: "PDC",
        passwordHash: defaultPassword,
        phone: "+52 984 100 0010",
        isActive: true,
      },
    });
    console.log(`  - Hostess: ${paola.name} (${paola.email})`);

    // Marketing
    const luis = await tx.user.create({
      data: {
        email: "marketing@propyte.com",
        name: "Luis Flores",
        role: "MARKETING",
        careerLevel: "JR",
        plaza: "PDC",
        passwordHash: defaultPassword,
        phone: "+52 984 100 0011",
        isActive: true,
      },
    });
    console.log(`  - Marketing: ${luis.name} (${luis.email})`);

    // Developer Externo
    const devExt = await tx.user.create({
      data: {
        email: "devext@propyte.com",
        name: "Demo Developer",
        role: "DEVELOPER_EXT",
        careerLevel: "JR",
        plaza: "PDC",
        passwordHash: defaultPassword,
        phone: "+52 984 100 0012",
        isActive: true,
      },
    });
    console.log(`  - Dev Ext: ${devExt.name} (${devExt.email})`);

    // Arreglo de asesores para asignación de contactos
    const asesores = [maria, diego, sofia, alejandro, valentina];

    // ================================================================
    // 2. DESARROLLOS Y UNIDADES
    // ================================================================
    console.log("\n🏘️  Creando desarrollos y unidades...");

    // --- Nativa Tulum ---
    const nativaTulum = await tx.development.create({
      data: {
        name: "Nativa Tulum",
        developerName: "Propyte Desarrollos",
        developmentType: "PROPIO",
        location: "Carretera Tulum-Cobá Km 7.5, Tulum, Q.Roo",
        plaza: "TULUM",
        totalUnits: 10,
        availableUnits: 7,
        soldUnits: 2,
        reservedUnits: 1,
        priceMin: 3800000,
        priceMax: 4500000,
        currency: "MXN",
        totalDevelopmentValue: 41000000,
        commissionRate: 5.0,
        status: "CONSTRUCCION",
        constructionProgress: 65,
        deliveryDate: new Date("2027-06-01"),
        amenities: ["Alberca", "Rooftop", "Coworking", "Gym", "Jardín zen"],
        description:
          "Desarrollo residencial boutique en la selva de Tulum con 10 departamentos de lujo. Arquitectura biofílica integrada al entorno natural.",
      },
    });
    console.log(`  - ${nativaTulum.name}: ${nativaTulum.totalUnits} unidades`);

    // Unidades de Nativa Tulum
    const nativaUnits = [
      { unitNumber: "NT-101", unitType: "DEPTO_1REC" as const, area_m2: 55, price: 3800000, floor: 1, status: "DISPONIBLE" as const },
      { unitNumber: "NT-102", unitType: "DEPTO_2REC" as const, area_m2: 78, price: 4100000, floor: 1, status: "VENDIDA" as const },
      { unitNumber: "NT-201", unitType: "DEPTO_1REC" as const, area_m2: 55, price: 3900000, floor: 2, status: "DISPONIBLE" as const },
      { unitNumber: "NT-202", unitType: "DEPTO_2REC" as const, area_m2: 80, price: 4200000, floor: 2, status: "APARTADA" as const },
      { unitNumber: "NT-301", unitType: "DEPTO_2REC" as const, area_m2: 82, price: 4300000, floor: 3, status: "DISPONIBLE" as const },
      { unitNumber: "NT-302", unitType: "DEPTO_2REC" as const, area_m2: 85, price: 4350000, floor: 3, status: "DISPONIBLE" as const },
      { unitNumber: "NT-401", unitType: "DEPTO_2REC" as const, area_m2: 88, price: 4400000, floor: 4, status: "DISPONIBLE" as const },
      { unitNumber: "NT-402", unitType: "DEPTO_2REC" as const, area_m2: 90, price: 4450000, floor: 4, status: "VENDIDA" as const },
      { unitNumber: "NT-PH1", unitType: "PENTHOUSE" as const, area_m2: 120, price: 4500000, floor: 5, status: "DISPONIBLE" as const },
      { unitNumber: "NT-PH2", unitType: "PENTHOUSE" as const, area_m2: 125, price: 4500000, floor: 5, status: "DISPONIBLE" as const },
    ];

    for (const u of nativaUnits) {
      await tx.unit.create({
        data: { developmentId: nativaTulum.id, currency: "MXN", ...u },
      });
    }
    console.log(`    → ${nativaUnits.length} unidades creadas`);

    // --- Macrolotes Tulum ---
    const macrolotes = await tx.development.create({
      data: {
        name: "Macrolotes Tulum",
        developerName: "Propyte Desarrollos",
        developmentType: "PROPIO",
        location: "Región 15, Tulum, Q.Roo",
        plaza: "TULUM",
        totalUnits: 5,
        availableUnits: 3,
        soldUnits: 1,
        reservedUnits: 1,
        priceMin: 2000000,
        priceMax: 5000000,
        currency: "MXN",
        totalDevelopmentValue: 18000000,
        commissionRate: 4.0,
        status: "PREVENTA",
        constructionProgress: 0,
        amenities: ["Acceso pavimentado", "Electricidad", "Agua potable"],
        description:
          "5 macrolotes premium en zona de alta plusvalía de Tulum. Ideales para desarrollo residencial o comercial.",
      },
    });
    console.log(`  - ${macrolotes.name}: ${macrolotes.totalUnits} unidades`);

    // Unidades (macrolotes)
    const macroloteUnits = [
      { unitNumber: "ML-01", unitType: "MACROLOTE" as const, area_m2: 2500, price: 5000000, status: "VENDIDA" as const },
      { unitNumber: "ML-02", unitType: "MACROLOTE" as const, area_m2: 2000, price: 4000000, status: "APARTADA" as const },
      { unitNumber: "ML-03", unitType: "TERRENO" as const, area_m2: 1500, price: 3000000, status: "DISPONIBLE" as const },
      { unitNumber: "ML-04", unitType: "TERRENO" as const, area_m2: 1200, price: 2400000, status: "DISPONIBLE" as const },
      { unitNumber: "ML-05", unitType: "TERRENO" as const, area_m2: 1000, price: 2000000, status: "DISPONIBLE" as const },
    ];

    for (const u of macroloteUnits) {
      await tx.unit.create({
        data: { developmentId: macrolotes.id, currency: "MXN", ...u },
      });
    }
    console.log(`    → ${macroloteUnits.length} unidades creadas`);

    // --- Riviera Gardens ---
    const riviera = await tx.development.create({
      data: {
        name: "Riviera Gardens",
        developerName: "Grupo Riviera",
        developmentType: "MASTERBROKER",
        location: "Av. Constituyentes 123, Playa del Carmen, Q.Roo",
        plaza: "PDC",
        totalUnits: 20,
        availableUnits: 14,
        soldUnits: 4,
        reservedUnits: 2,
        priceMin: 5500000,
        priceMax: 18000000,
        currency: "MXN",
        totalDevelopmentValue: 200000000,
        commissionRate: 6.0,
        status: "CONSTRUCCION",
        constructionProgress: 40,
        deliveryDate: new Date("2028-03-01"),
        amenities: [
          "Alberca infinity",
          "Beach club",
          "Spa",
          "Gym",
          "Restaurante",
          "Kids club",
          "Seguridad 24/7",
          "Estacionamiento subterráneo",
        ],
        description:
          "Complejo residencial premium en Playa del Carmen con 20 unidades de distintos tipos. Vista al mar y acceso directo a la playa.",
      },
    });
    console.log(`  - ${riviera.name}: ${riviera.totalUnits} unidades`);

    // Unidades de Riviera Gardens (variedad de tipos)
    const rivieraUnits = [
      { unitNumber: "RG-101", unitType: "DEPTO_1REC" as const, area_m2: 60, price: 5500000, floor: 1, status: "VENDIDA" as const },
      { unitNumber: "RG-102", unitType: "DEPTO_1REC" as const, area_m2: 62, price: 5700000, floor: 1, status: "DISPONIBLE" as const },
      { unitNumber: "RG-103", unitType: "DEPTO_2REC" as const, area_m2: 90, price: 7800000, floor: 1, status: "DISPONIBLE" as const },
      { unitNumber: "RG-201", unitType: "DEPTO_2REC" as const, area_m2: 92, price: 8200000, floor: 2, status: "VENDIDA" as const },
      { unitNumber: "RG-202", unitType: "DEPTO_2REC" as const, area_m2: 95, price: 8500000, floor: 2, status: "APARTADA" as const },
      { unitNumber: "RG-203", unitType: "DEPTO_3REC" as const, area_m2: 130, price: 11000000, floor: 2, status: "DISPONIBLE" as const },
      { unitNumber: "RG-301", unitType: "DEPTO_2REC" as const, area_m2: 94, price: 8800000, floor: 3, status: "DISPONIBLE" as const },
      { unitNumber: "RG-302", unitType: "DEPTO_3REC" as const, area_m2: 135, price: 11500000, floor: 3, status: "DISPONIBLE" as const },
      { unitNumber: "RG-303", unitType: "DEPTO_3REC" as const, area_m2: 140, price: 12000000, floor: 3, status: "VENDIDA" as const },
      { unitNumber: "RG-401", unitType: "DEPTO_3REC" as const, area_m2: 138, price: 12500000, floor: 4, status: "DISPONIBLE" as const },
      { unitNumber: "RG-402", unitType: "PENTHOUSE" as const, area_m2: 180, price: 16000000, floor: 4, status: "APARTADA" as const },
      { unitNumber: "RG-PH1", unitType: "PENTHOUSE" as const, area_m2: 200, price: 18000000, floor: 5, status: "DISPONIBLE" as const },
      { unitNumber: "RG-PH2", unitType: "PENTHOUSE" as const, area_m2: 195, price: 17500000, floor: 5, status: "DISPONIBLE" as const },
      { unitNumber: "RG-LC1", unitType: "LOCAL" as const, area_m2: 80, price: 9000000, floor: 0, status: "DISPONIBLE" as const },
      { unitNumber: "RG-LC2", unitType: "LOCAL" as const, area_m2: 120, price: 13500000, floor: 0, status: "VENDIDA" as const },
      { unitNumber: "RG-C01", unitType: "CASA" as const, area_m2: 250, price: 15000000, floor: 0, status: "DISPONIBLE" as const },
      { unitNumber: "RG-C02", unitType: "CASA" as const, area_m2: 280, price: 16500000, floor: 0, status: "DISPONIBLE" as const },
      { unitNumber: "RG-C03", unitType: "CASA" as const, area_m2: 300, price: 17000000, floor: 0, status: "DISPONIBLE" as const },
      { unitNumber: "RG-C04", unitType: "CASA" as const, area_m2: 260, price: 15500000, floor: 0, status: "DISPONIBLE" as const },
      { unitNumber: "RG-C05", unitType: "CASA" as const, area_m2: 270, price: 16000000, floor: 0, status: "DISPONIBLE" as const },
    ];

    for (const u of rivieraUnits) {
      await tx.unit.create({
        data: { developmentId: riviera.id, currency: "MXN", ...u },
      });
    }
    console.log(`    → ${rivieraUnits.length} unidades creadas`);

    // ================================================================
    // 3. CONTACTOS (20 contactos realistas)
    // ================================================================
    console.log("\n📇 Creando contactos...");

    const contactsData = [
      {
        firstName: "Rodrigo", lastName: "Martínez Vega",
        email: "rodrigo.martinez@gmail.com", phone: "+52 55 1234 5678",
        contactType: "LEAD" as const, leadSource: "FACEBOOK_ADS" as const,
        temperature: "HOT" as const, investmentProfile: "INVESTOR_RENTAL" as const,
        budgetMin: 4000000, budgetMax: 6000000, preferredZone: "Tulum",
        assignedToId: maria.id, score: 85, tags: ["inversionista", "urgente"],
      },
      {
        firstName: "Fernanda", lastName: "Gutiérrez López",
        email: "fer.gutierrez@outlook.com", phone: "+52 33 9876 5432",
        contactType: "PROSPECTO" as const, leadSource: "GOOGLE_ADS" as const,
        temperature: "WARM" as const, investmentProfile: "END_USER" as const,
        budgetMin: 5000000, budgetMax: 8000000, preferredZone: "Playa del Carmen",
        assignedToId: diego.id, score: 65, tags: ["familiar"],
      },
      {
        firstName: "Miguel Ángel", lastName: "Castillo Reyes",
        email: "macastillo@yahoo.com", phone: "+52 81 5555 1234",
        contactType: "CLIENTE" as const, leadSource: "REFERIDO_CLIENTE" as const,
        temperature: "HOT" as const, investmentProfile: "INVESTOR_FLIP" as const,
        budgetMin: 8000000, budgetMax: 15000000, preferredZone: "Playa del Carmen",
        assignedToId: maria.id, score: 92, tags: ["vip", "referido"],
      },
      {
        firstName: "Ana Lucía", lastName: "Herrera Domínguez",
        email: "analucia.herrera@gmail.com", phone: "+52 984 200 1111",
        contactType: "LEAD" as const, leadSource: "WALK_IN" as const,
        temperature: "WARM" as const, investmentProfile: "END_USER" as const,
        budgetMin: 3500000, budgetMax: 5000000, preferredZone: "Tulum",
        assignedToId: alejandro.id, score: 55, tags: ["walk-in"],
      },
      {
        firstName: "José Luis", lastName: "Peña Morales",
        email: "jlpena@hotmail.com", phone: "+52 55 4444 7890",
        contactType: "INVERSIONISTA" as const, leadSource: "PORTAL_INMOBILIARIO" as const,
        temperature: "HOT" as const, investmentProfile: "INVESTOR_LAND" as const,
        budgetMin: 2000000, budgetMax: 5000000, preferredZone: "Tulum",
        assignedToId: valentina.id, score: 78, tags: ["terrenos", "inversionista"],
      },
      {
        firstName: "Camila", lastName: "Ríos Salazar",
        email: "camila.rios@icloud.com", phone: "+52 998 300 2222",
        contactType: "PROSPECTO" as const, leadSource: "INSTAGRAM" as const,
        temperature: "COLD" as const, investmentProfile: "MIXED" as const,
        budgetMin: 6000000, budgetMax: 10000000, preferredZone: "Cancún",
        assignedToId: sofia.id, score: 40, tags: ["redes-sociales"],
      },
      {
        firstName: "Eduardo", lastName: "Vargas Mendoza",
        email: "eduardo.vargas@empresa.mx", phone: "+52 222 111 3333",
        contactType: "LEAD" as const, leadSource: "WEBSITE" as const,
        temperature: "WARM" as const, investmentProfile: "INVESTOR_RENTAL" as const,
        budgetMin: 4500000, budgetMax: 7000000, preferredZone: "Playa del Carmen",
        assignedToId: diego.id, score: 60, tags: ["web"],
      },
      {
        firstName: "Patricia", lastName: "Navarro García",
        email: "patricia.navarro@gmail.com", phone: "+52 33 8888 4444",
        contactType: "BROKER_EXTERNO" as const, leadSource: "REFERIDO_BROKER" as const,
        temperature: "HOT" as const, investmentProfile: "INVESTOR_FLIP" as const,
        budgetMin: 10000000, budgetMax: 15000000, preferredZone: "Playa del Carmen",
        assignedToId: maria.id, score: 88, tags: ["broker", "alta-inversión"],
      },
      {
        firstName: "Ricardo", lastName: "Delgado Fuentes",
        email: "rdelgadof@gmail.com", phone: "+52 55 7777 5555",
        contactType: "LEAD" as const, leadSource: "FACEBOOK_ADS" as const,
        temperature: "COLD" as const, investmentProfile: "END_USER" as const,
        budgetMin: 3000000, budgetMax: 4500000, preferredZone: "Tulum",
        assignedToId: alejandro.id, score: 30, tags: ["facebook"],
      },
      {
        firstName: "Gabriela", lastName: "Ortiz Jiménez",
        email: "gaby.ortiz@outlook.com", phone: "+52 984 500 6666",
        contactType: "PROSPECTO" as const, leadSource: "EVENTO" as const,
        temperature: "WARM" as const, investmentProfile: "INVESTOR_RENTAL" as const,
        budgetMin: 5000000, budgetMax: 9000000, preferredZone: "Playa del Carmen",
        assignedToId: sofia.id, score: 70, tags: ["evento", "seguimiento"],
      },
      {
        firstName: "Arturo", lastName: "Soto Campos",
        email: "arturo.soto@protonmail.com", phone: "+52 81 2222 8888",
        contactType: "LEAD" as const, leadSource: "GOOGLE_ADS" as const,
        temperature: "HOT" as const, investmentProfile: "INVESTOR_LAND" as const,
        budgetMin: 2500000, budgetMax: 4000000, preferredZone: "Tulum",
        assignedToId: valentina.id, score: 75, tags: ["macrolotes"],
      },
      {
        firstName: "Mariana", lastName: "Contreras Ruiz",
        email: "mariana.cr@gmail.com", phone: "+52 55 3333 9999",
        contactType: "REFERIDO" as const, leadSource: "REFERIDO_CLIENTE" as const,
        temperature: "WARM" as const, investmentProfile: "END_USER" as const,
        budgetMin: 7000000, budgetMax: 12000000, preferredZone: "Playa del Carmen",
        assignedToId: diego.id, score: 68, tags: ["referido", "premium"],
      },
      {
        firstName: "Héctor", lastName: "Luna Espinoza",
        email: "hector.luna@yahoo.com", phone: "+52 998 400 1010",
        contactType: "LEAD" as const, leadSource: "WHATSAPP" as const,
        temperature: "COLD" as const, investmentProfile: "MIXED" as const,
        budgetMin: 3000000, budgetMax: 6000000, preferredZone: "Cancún",
        assignedToId: alejandro.id, score: 35, tags: ["whatsapp"],
      },
      {
        firstName: "Laura", lastName: "Aguilar Paredes",
        email: "laura.aguilar@empresa.com", phone: "+52 33 5555 2020",
        contactType: "PROSPECTO" as const, leadSource: "LLAMADA_FRIA" as const,
        temperature: "WARM" as const, investmentProfile: "INVESTOR_RENTAL" as const,
        budgetMin: 4000000, budgetMax: 7000000, preferredZone: "Tulum",
        assignedToId: maria.id, score: 62, tags: ["llamada-fria"],
      },
      {
        firstName: "Daniel", lastName: "Méndez Ibarra",
        email: "daniel.mendez.i@gmail.com", phone: "+52 55 6666 3030",
        contactType: "INVERSIONISTA" as const, leadSource: "PORTAL_INMOBILIARIO" as const,
        temperature: "HOT" as const, investmentProfile: "INVESTOR_FLIP" as const,
        budgetMin: 9000000, budgetMax: 14000000, preferredZone: "Playa del Carmen",
        assignedToId: sofia.id, score: 82, tags: ["inversionista", "portal"],
      },
      {
        firstName: "Valeria", lastName: "Castro León",
        email: "vale.castro@outlook.com", phone: "+52 984 600 4040",
        contactType: "LEAD" as const, leadSource: "INSTAGRAM" as const,
        temperature: "COLD" as const, investmentProfile: "END_USER" as const,
        budgetMin: 3500000, budgetMax: 5500000, preferredZone: "Tulum",
        assignedToId: valentina.id, score: 28, tags: ["instagram", "joven"],
      },
      {
        firstName: "Francisco", lastName: "Ramos Durán",
        email: "francisco.ramos@gmail.com", phone: "+52 81 7777 5050",
        contactType: "CLIENTE" as const, leadSource: "REFERIDO_BROKER" as const,
        temperature: "HOT" as const, investmentProfile: "INVESTOR_RENTAL" as const,
        budgetMin: 6000000, budgetMax: 10000000, preferredZone: "Playa del Carmen",
        assignedToId: diego.id, score: 90, tags: ["broker", "repetidor"],
      },
      {
        firstName: "Isabella", lastName: "Moreno Pacheco",
        email: "isabella.moreno@icloud.com", phone: "+52 55 8888 6060",
        contactType: "LEAD" as const, leadSource: "WEBSITE" as const,
        temperature: "WARM" as const, investmentProfile: "INVESTOR_LAND" as const,
        budgetMin: 2000000, budgetMax: 3500000, preferredZone: "Tulum",
        assignedToId: alejandro.id, score: 50, tags: ["web", "terrenos"],
      },
      {
        firstName: "Andrés", lastName: "Flores Quiroz",
        email: "andres.fq@hotmail.com", phone: "+52 998 700 7070",
        contactType: "PROSPECTO" as const, leadSource: "OTRO" as const,
        temperature: "COLD" as const, investmentProfile: "END_USER" as const,
        budgetMin: 4000000, budgetMax: 6000000, preferredZone: "Cancún",
        assignedToId: sofia.id, score: 38, tags: ["otro"],
      },
      {
        firstName: "Natalia", lastName: "Cervantes Solís",
        email: "natalia.cervantes@gmail.com", phone: "+52 33 9999 8080",
        contactType: "LEAD" as const, leadSource: "FACEBOOK_ADS" as const,
        temperature: "WARM" as const, investmentProfile: "MIXED" as const,
        budgetMin: 5000000, budgetMax: 8000000, preferredZone: "Playa del Carmen",
        assignedToId: maria.id, score: 58, tags: ["facebook", "seguimiento"],
      },
    ];

    // Crear todos los contactos y guardar referencias
    const contacts = [];
    for (const c of contactsData) {
      const contact = await tx.contact.create({ data: c });
      contacts.push(contact);
    }
    console.log(`  ✅ ${contacts.length} contactos creados`);

    // ================================================================
    // 4. DEALS (10 operaciones en diferentes etapas del pipeline)
    // ================================================================
    console.log("\n💼 Creando deals...");

    // Obtener IDs de unidades para asociar a deals
    const allUnits = await tx.unit.findMany({
      where: { developmentId: { in: [nativaTulum.id, macrolotes.id, riviera.id] } },
    });

    // Función auxiliar para encontrar unidad por número
    const findUnit = (num: string) => allUnits.find((u) => u.unitNumber === num);

    const dealsData = [
      {
        contactId: contacts[0].id, assignedToId: maria.id,
        developmentId: nativaTulum.id, unitId: findUnit("NT-202")?.id,
        stage: "RESERVED" as const, dealType: "NATIVA_CONTADO" as const,
        estimatedValue: 4200000, probability: 90,
        expectedCloseDate: new Date("2026-04-15"),
        leadSourceAtDeal: "FACEBOOK_ADS",
      },
      {
        contactId: contacts[2].id, assignedToId: maria.id,
        developmentId: riviera.id, unitId: findUnit("RG-402")?.id,
        stage: "CONTRACT_SIGNED" as const, dealType: "MASTERBROKER" as const,
        estimatedValue: 16000000, probability: 95,
        expectedCloseDate: new Date("2026-05-01"),
        leadSourceAtDeal: "REFERIDO_CLIENTE",
      },
      {
        contactId: contacts[1].id, assignedToId: diego.id,
        developmentId: riviera.id,
        stage: "PROPOSAL_SENT" as const, dealType: "MASTERBROKER" as const,
        estimatedValue: 8500000, probability: 65,
        expectedCloseDate: new Date("2026-06-01"),
        leadSourceAtDeal: "GOOGLE_ADS",
      },
      {
        contactId: contacts[4].id, assignedToId: valentina.id,
        developmentId: macrolotes.id, unitId: findUnit("ML-02")?.id,
        stage: "NEGOTIATION" as const, dealType: "MACROLOTE" as const,
        estimatedValue: 4000000, probability: 75,
        expectedCloseDate: new Date("2026-04-30"),
        leadSourceAtDeal: "PORTAL_INMOBILIARIO",
      },
      {
        contactId: contacts[3].id, assignedToId: alejandro.id,
        developmentId: nativaTulum.id,
        stage: "MEETING_COMPLETED" as const, dealType: "NATIVA_FINANCIAMIENTO" as const,
        estimatedValue: 4300000, probability: 50,
        expectedCloseDate: new Date("2026-07-15"),
        leadSourceAtDeal: "WALK_IN",
      },
      {
        contactId: contacts[7].id, assignedToId: maria.id,
        developmentId: riviera.id,
        stage: "DISCOVERY_DONE" as const, dealType: "MASTERBROKER" as const,
        estimatedValue: 15000000, probability: 20,
        expectedCloseDate: new Date("2026-08-01"),
        leadSourceAtDeal: "REFERIDO_BROKER",
      },
      {
        contactId: contacts[10].id, assignedToId: valentina.id,
        developmentId: macrolotes.id,
        stage: "CONTACTED" as const, dealType: "MACROLOTE" as const,
        estimatedValue: 3000000, probability: 10,
        expectedCloseDate: new Date("2026-09-01"),
        leadSourceAtDeal: "GOOGLE_ADS",
      },
      {
        contactId: contacts[14].id, assignedToId: sofia.id,
        developmentId: riviera.id, unitId: findUnit("RG-202")?.id,
        stage: "WON" as const, dealType: "MASTERBROKER" as const,
        estimatedValue: 8500000, probability: 100,
        expectedCloseDate: new Date("2026-02-15"),
        actualCloseDate: new Date("2026-02-20"),
        leadSourceAtDeal: "PORTAL_INMOBILIARIO",
      },
      {
        contactId: contacts[16].id, assignedToId: diego.id,
        developmentId: riviera.id,
        stage: "MEETING_SCHEDULED" as const, dealType: "MASTERBROKER" as const,
        estimatedValue: 9000000, probability: 35,
        expectedCloseDate: new Date("2026-07-01"),
        leadSourceAtDeal: "REFERIDO_BROKER",
      },
      {
        contactId: contacts[8].id, assignedToId: alejandro.id,
        developmentId: nativaTulum.id,
        stage: "NEW_LEAD" as const, dealType: "NATIVA_CONTADO" as const,
        estimatedValue: 3900000, probability: 5,
        expectedCloseDate: new Date("2026-10-01"),
        leadSourceAtDeal: "FACEBOOK_ADS",
      },
    ];

    const deals = [];
    for (const d of dealsData) {
      const deal = await tx.deal.create({ data: d });
      deals.push(deal);
    }
    console.log(`  ✅ ${deals.length} deals creados`);

    // ================================================================
    // 5. REGLAS DE COMISIÓN
    // 5 tipos de deal × 3 categorías de fuente × roles relevantes
    // ================================================================
    console.log("\n💰 Creando reglas de comisión...");

    const dealTypes = [
      "NATIVA_CONTADO",
      "NATIVA_FINANCIAMIENTO",
      "MACROLOTE",
      "CORRETAJE",
      "MASTERBROKER",
    ] as const;

    const leadSourceCategories = [
      "PROPYTE_LEAD",
      "BROKER_LEAD",
      "ASESOR_LEAD",
    ] as const;

    // Porcentajes por tipo de deal, categoría de fuente y rol
    // Formato: [dealType][sourceCategory] = { role: porcentaje }
    const commissionMatrix: Record<
      string,
      Record<string, Record<string, number>>
    > = {
      NATIVA_CONTADO: {
        PROPYTE_LEAD: { ASESOR_JR: 2.0, ASESOR_SR: 2.5, TEAM_LEADER: 0.5, GERENTE: 0.3, DIRECTOR: 0.2 },
        BROKER_LEAD: { ASESOR_JR: 1.5, ASESOR_SR: 2.0, TEAM_LEADER: 0.4, GERENTE: 0.3, DIRECTOR: 0.2 },
        ASESOR_LEAD: { ASESOR_JR: 3.0, ASESOR_SR: 3.5, TEAM_LEADER: 0.5, GERENTE: 0.3, DIRECTOR: 0.2 },
      },
      NATIVA_FINANCIAMIENTO: {
        PROPYTE_LEAD: { ASESOR_JR: 1.5, ASESOR_SR: 2.0, TEAM_LEADER: 0.4, GERENTE: 0.25, DIRECTOR: 0.15 },
        BROKER_LEAD: { ASESOR_JR: 1.0, ASESOR_SR: 1.5, TEAM_LEADER: 0.3, GERENTE: 0.25, DIRECTOR: 0.15 },
        ASESOR_LEAD: { ASESOR_JR: 2.5, ASESOR_SR: 3.0, TEAM_LEADER: 0.4, GERENTE: 0.25, DIRECTOR: 0.15 },
      },
      MACROLOTE: {
        PROPYTE_LEAD: { ASESOR_JR: 1.0, ASESOR_SR: 1.5, TEAM_LEADER: 0.3, GERENTE: 0.2, DIRECTOR: 0.1 },
        BROKER_LEAD: { ASESOR_JR: 0.8, ASESOR_SR: 1.2, TEAM_LEADER: 0.25, GERENTE: 0.2, DIRECTOR: 0.1 },
        ASESOR_LEAD: { ASESOR_JR: 1.5, ASESOR_SR: 2.0, TEAM_LEADER: 0.3, GERENTE: 0.2, DIRECTOR: 0.1 },
      },
      CORRETAJE: {
        PROPYTE_LEAD: { ASESOR_JR: 1.5, ASESOR_SR: 2.0, TEAM_LEADER: 0.4, GERENTE: 0.25, DIRECTOR: 0.15 },
        BROKER_LEAD: { ASESOR_JR: 1.2, ASESOR_SR: 1.8, TEAM_LEADER: 0.35, GERENTE: 0.25, DIRECTOR: 0.15 },
        ASESOR_LEAD: { ASESOR_JR: 2.0, ASESOR_SR: 2.5, TEAM_LEADER: 0.4, GERENTE: 0.25, DIRECTOR: 0.15 },
      },
      MASTERBROKER: {
        PROPYTE_LEAD: { ASESOR_JR: 2.5, ASESOR_SR: 3.0, TEAM_LEADER: 0.5, GERENTE: 0.35, DIRECTOR: 0.25 },
        BROKER_LEAD: { ASESOR_JR: 2.0, ASESOR_SR: 2.5, TEAM_LEADER: 0.45, GERENTE: 0.35, DIRECTOR: 0.25 },
        ASESOR_LEAD: { ASESOR_JR: 3.5, ASESOR_SR: 4.0, TEAM_LEADER: 0.5, GERENTE: 0.35, DIRECTOR: 0.25 },
      },
    };

    let ruleCount = 0;
    for (const dt of dealTypes) {
      for (const lsc of leadSourceCategories) {
        const roles = commissionMatrix[dt][lsc];
        for (const [role, percentage] of Object.entries(roles)) {
          await tx.commissionRule.create({
            data: {
              dealType: dt,
              leadSourceCategory: lsc,
              role: role as any,
              percentage,
              isActive: true,
            },
          });
          ruleCount++;
        }
      }
    }
    console.log(`  ✅ ${ruleCount} reglas de comisión creadas`);

    // ================================================================
    // 6. CONFIGURACIÓN DEL SISTEMA
    // ================================================================
    console.log("\n⚙️  Creando configuración del sistema...");

    const systemConfigs = [
      {
        key: "activity_agreement_min_daily_calls",
        value: { value: 20, description: "Mínimo de llamadas diarias por asesor" },
      },
      {
        key: "activity_agreement_min_daily_whatsapps",
        value: { value: 30, description: "Mínimo de mensajes WhatsApp diarios" },
      },
      {
        key: "activity_agreement_min_weekly_visits",
        value: { value: 5, description: "Mínimo de visitas semanales" },
      },
      {
        key: "activity_agreement_min_daily_followups",
        value: { value: 10, description: "Mínimo de seguimientos diarios" },
      },
      {
        key: "activity_agreement_max_first_response_minutes",
        value: { value: 5, description: "Tiempo máximo de primera respuesta (minutos)" },
      },
      {
        key: "activity_agreement_max_inactivity_days",
        value: { value: 2, description: "Máximo de días sin actividad antes de alerta" },
      },
      {
        key: "lead_assignment_mode",
        value: { value: "ROUND_ROBIN", description: "Modo de asignación de leads nuevos" },
      },
      {
        key: "deal_stagnation_alert_days",
        value: { value: 7, description: "Días para alerta de deal estancado" },
      },
    ];

    for (const cfg of systemConfigs) {
      await tx.systemConfig.create({ data: cfg });
    }
    console.log(`  ✅ ${systemConfigs.length} configuraciones creadas`);

    // ================================================================
    // 7. ACTIVIDADES (15+ actividades de muestra)
    // ================================================================
    console.log("\n📋 Creando actividades...");

    const activitiesData = [
      {
        contactId: contacts[0].id, dealId: deals[0].id, userId: maria.id,
        activityType: "CALL_OUTBOUND" as const,
        subject: "Llamada de primer contacto con Rodrigo",
        description: "Se contactó a Rodrigo para presentar opciones en Nativa Tulum. Muy interesado en depto 2 recámaras.",
        status: "COMPLETADA" as const, completedAt: new Date("2026-03-01"), duration_minutes: 15,
      },
      {
        contactId: contacts[0].id, dealId: deals[0].id, userId: maria.id,
        activityType: "WHATSAPP_OUT" as const,
        subject: "Envío de brochure Nativa Tulum",
        description: "Se envió brochure digital y tabla de precios actualizada por WhatsApp.",
        status: "COMPLETADA" as const, completedAt: new Date("2026-03-02"), duration_minutes: 5,
      },
      {
        contactId: contacts[0].id, dealId: deals[0].id, userId: maria.id,
        activityType: "MEETING_PRESENTIAL" as const,
        subject: "Visita al showroom Nativa Tulum",
        description: "Rodrigo visitó el showroom. Le gustó mucho la unidad NT-202. Quiere apartar.",
        status: "COMPLETADA" as const, completedAt: new Date("2026-03-05"), duration_minutes: 60,
      },
      {
        contactId: contacts[1].id, dealId: deals[2].id, userId: diego.id,
        activityType: "DISCOVERY_CALL" as const,
        subject: "Discovery call con Fernanda",
        description: "Fernanda busca depto familiar 2-3 recámaras en PDC. Presupuesto 5-8M MXN. Financiamiento bancario.",
        status: "COMPLETADA" as const, completedAt: new Date("2026-03-03"), duration_minutes: 25,
      },
      {
        contactId: contacts[1].id, dealId: deals[2].id, userId: diego.id,
        activityType: "PROPOSAL_DELIVERY" as const,
        subject: "Envío de propuesta Riviera Gardens",
        description: "Se envió propuesta formal para unidad RG-202 y RG-203 con opciones de financiamiento.",
        status: "COMPLETADA" as const, completedAt: new Date("2026-03-08"), duration_minutes: 30,
      },
      {
        contactId: contacts[2].id, dealId: deals[1].id, userId: maria.id,
        activityType: "CONTRACT_REVIEW" as const,
        subject: "Revisión de contrato PH RG-402",
        description: "Miguel Ángel revisó contrato con su abogado. Pendiente firma para próxima semana.",
        status: "COMPLETADA" as const, completedAt: new Date("2026-03-10"), duration_minutes: 45,
      },
      {
        contactId: contacts[4].id, dealId: deals[3].id, userId: valentina.id,
        activityType: "MEETING_VIRTUAL" as const,
        subject: "Reunión virtual sobre macrolote ML-02",
        description: "José Luis quiere negociar precio del macrolote ML-02. Ofrece pago de contado.",
        status: "COMPLETADA" as const, completedAt: new Date("2026-03-06"), duration_minutes: 40,
      },
      {
        contactId: contacts[3].id, dealId: deals[4].id, userId: alejandro.id,
        activityType: "MEETING_SHOWROOM" as const,
        subject: "Visita guiada a Nativa Tulum",
        description: "Ana Lucía visitó el desarrollo con su esposo. Interesados en planta baja o primer piso.",
        status: "COMPLETADA" as const, completedAt: new Date("2026-03-07"), duration_minutes: 90,
      },
      {
        contactId: contacts[7].id, dealId: deals[5].id, userId: maria.id,
        activityType: "CALL_INBOUND" as const,
        subject: "Llamada entrante de Patricia (broker externo)",
        description: "Patricia busca propiedad premium para cliente de CDMX. Presupuesto alto. Agenda visita.",
        status: "COMPLETADA" as const, completedAt: new Date("2026-03-04"), duration_minutes: 20,
      },
      {
        contactId: contacts[10].id, dealId: deals[6].id, userId: valentina.id,
        activityType: "WHATSAPP_OUT" as const,
        subject: "Seguimiento WhatsApp a Arturo",
        description: "Se envió información de macrolotes disponibles y precios. Pendiente respuesta.",
        status: "COMPLETADA" as const, completedAt: new Date("2026-03-09"), duration_minutes: 10,
      },
      {
        contactId: contacts[16].id, dealId: deals[8].id, userId: diego.id,
        activityType: "MEETING_PRESENTIAL" as const,
        subject: "Visita agendada con Francisco a Riviera Gardens",
        dueDate: new Date("2026-03-18"),
        status: "PENDIENTE" as const, duration_minutes: 60,
      },
      {
        contactId: contacts[5].id, userId: sofia.id,
        activityType: "FOLLOW_UP" as const,
        subject: "Seguimiento a Camila - lead frío",
        description: "Tercer intento de contacto. No responde llamadas ni WhatsApp.",
        dueDate: new Date("2026-03-20"),
        status: "PENDIENTE" as const,
      },
      {
        contactId: contacts[8].id, dealId: deals[9].id, userId: alejandro.id,
        activityType: "CALL_OUTBOUND" as const,
        subject: "Primer contacto con Ricardo",
        description: "Ricardo dejó datos en Facebook. Interesado en Tulum para vacaciones.",
        dueDate: new Date("2026-03-15"),
        status: "PENDIENTE" as const,
      },
      {
        contactId: contacts[14].id, dealId: deals[7].id, userId: sofia.id,
        activityType: "CLOSING_ACTIVITY" as const,
        subject: "Escrituración Daniel Méndez - RG-202",
        description: "Escrituración completada. Deal ganado.",
        status: "COMPLETADA" as const, completedAt: new Date("2026-02-20"), duration_minutes: 120,
      },
      {
        contactId: contacts[19].id, userId: maria.id,
        activityType: "EMAIL_SENT" as const,
        subject: "Email con opciones para Natalia",
        description: "Se envió email con comparativa de desarrollos PDC: Riviera Gardens vs competencia.",
        status: "COMPLETADA" as const, completedAt: new Date("2026-03-11"), duration_minutes: 20,
      },
      {
        contactId: contacts[11].id, userId: diego.id,
        activityType: "TASK" as const,
        subject: "Preparar propuesta para Mariana",
        description: "Preparar comparativa de unidades Riviera Gardens para referida Mariana.",
        dueDate: new Date("2026-03-17"),
        status: "PENDIENTE" as const,
      },
      {
        contactId: contacts[13].id, userId: maria.id,
        activityType: "NOTE" as const,
        subject: "Nota sobre Laura Aguilar",
        description: "Laura mencionó que su esposo tiene propiedad en Tulum. Posible segundo cierre futuro.",
        status: "COMPLETADA" as const, completedAt: new Date("2026-03-09"),
      },
    ];

    for (const a of activitiesData) {
      await tx.activity.create({ data: a });
    }
    console.log(`  ✅ ${activitiesData.length} actividades creadas`);

    console.log("\n🎉 Seed completado exitosamente!");
    console.log(`
    Resumen:
    ────────────────────────────
    Usuarios:       12
    Desarrollos:     3
    Unidades:       35
    Contactos:      20
    Deals:          10
    Reglas comisión: ${ruleCount}
    Config sistema:  ${systemConfigs.length}
    Actividades:    ${activitiesData.length}
    ────────────────────────────
    `);
  }, { timeout: 60000 });
}

main()
  .catch((e) => {
    console.error("❌ Error durante el seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
