import { Injectable } from "@nestjs/common";
import { BusinessConfig, Tenant } from "generated/prisma/client";
import { CreateTenantDto } from "src/controllers/dto/tenant.dto";
import { PrismaService } from "src/prisma.service";


type createTenantData = {
    companyName:string,
    isVatRegistered:boolean,
    vatPercentage?:number
}

@Injectable()
export class TenantRepository {
    constructor (private prismaService:PrismaService){

    }

    async getTenants() {
        return await this.prismaService.tenant.findMany()
    }


    async getTenantById(id:string){
        return await this.prismaService.tenant.findUniqueOrThrow({
            where:{
                id
            }
        })
    }

    async getTenantByName(name:string){
        return await this.prismaService.tenant.findUniqueOrThrow({
            where:{
                companyName:name
            }
        })
    }

    async createTenant(data: createTenantData){
        return await this.prismaService.tenant.create({
            data:{
                companyName:data.companyName,
                isVatRegistered:data.isVatRegistered,
                vatPercentage:data.vatPercentage
            }
        })
    }


    async updateTenant(id:string, data:Partial<Tenant>){
        return await this.prismaService.tenant.update({
            where:{
                id
            },
            data:{
                companyName:data.companyName,
                isVatRegistered:data.isVatRegistered,
                vatPercentage:data.vatPercentage
            }
        })
    }

    async deleteTenant(id:string){
        return await this.prismaService.tenant.delete({
            where:{
                id
            }
        })
    }

    async createBusinessConfiguration(tenantId:string, data:Partial<BusinessConfig>){
        return await this.prismaService.businessConfig.create({
            data:{
                tenantId,
                ...data
            }
        })
    }

    async updateBusinessConfiguration(tenantId:string, data:Partial<BusinessConfig>){
        const existingConfig = await this.prismaService.businessConfig.findUnique({
            where:{
                tenantId
            }
        })

        if(!existingConfig){
            throw new Error("Business configuration not found for the tenant")
        }

        return await this.prismaService.businessConfig.update({
            where:{
                tenantId
            },
            data:{
                ...data
            }
        })
    }

    async getBusinessConfiguration(tenantId:string){
        return await this.prismaService.businessConfig.findUnique({
            where:{
                tenantId    
            }
        })
    }

    async deleteBusinessConfiguration(tenantId:string){
        return await this.prismaService.businessConfig.delete({
            where:{
                tenantId
            }
        })
    }

}