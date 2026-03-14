import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common"
import { BusinessConfig, Role, Tenant } from "generated/prisma/client"
import { Roles } from "src/common/decorators/roles.decorator"
import { TenantService } from "src/domain/tenant/tenant.service"
import { CreateTenantDto, TenantGetByNameDto, TenantGetDto } from "./dto/tenant.dto"


@Controller("tenants")
export class TenantController{
    constructor(private tenantService:TenantService){

    }


    @Get()
    @Roles("ADMIN")
    async getTenants(){
        return await this.tenantService.getTenants()
    }


    @Get(":id")
    @Roles("ADMIN")
    async getTenantById(@Param() param: TenantGetDto){
        return await this.tenantService.getTenantById(param.id)
    }


    @Get(":name")
    @Roles("ADMIN")
    async getTenantByName(@Param() param: TenantGetByNameDto){
        return await this.tenantService.getTenantByName(param.name)
    }


    @Post()
    @Roles("ADMIN")
    async createTenant(@Body() data:CreateTenantDto){
        return await this.tenantService.createTenant({
            companyName:data.companyName,
            isVatRegistered:data.isVatRegistered as boolean,
            vatPercentage:data.vatPercentage
        })
    
    }

    @Patch(":id")
    @Roles("ADMIN")
    async updateTenant(@Param("id") id: string, @Body() data: Partial<Tenant>){
        return await this.tenantService.updateTenant(id, data)
    }

    @Delete(":id")
    @Roles("ADMIN")
    async deleteTenant(@Param("id") id: string){
        return await this.tenantService.deleteTenant(id)
    }


    @Post(":tenantId/business-config")
    @Roles("ADMIN")
    async createDefaultBusinessConfig(@Param("tenantId") tenantId:string, @Body() data:{
        currency?:string,
        termsAndConditions?:string,
    }){
        return await this.tenantService.createDefaultBusinessConfig(tenantId, data)
    }

    @Get(":tenantId/business-config")
    @Roles("ADMIN")
    async getBusinessConfig(@Param("tenantId") tenantId:string){
        return await this.tenantService.getBusinessConfig(tenantId)
    }

    @Patch(":tenantId/business-config")
    @Roles("ADMIN")
    async updateBusinessConfig(@Param("tenantId") tenantId:string, @Body() data:Partial<BusinessConfig>){
        return await this.tenantService.updateBusinessConfig(tenantId, data)
    }

    @Delete(":tenantId/business-config")
    @Roles("ADMIN")
    async deleteBusinessConfig(@Param("tenantId") tenantId:string){
        return await this.tenantService.deleteBusinessConfig(tenantId)
    }

}