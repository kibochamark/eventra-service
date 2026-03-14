import { Injectable } from '@nestjs/common';
import { TenantRepository } from './tenant.repository';
import { BusinessConfig, Tenant } from 'generated/prisma/client';

@Injectable()
export class TenantService {
    constructor(private tenantRepository: TenantRepository){

    }


    async getTenants(){
        return await this.tenantRepository.getTenants()
    }

    async getTenantById(id:string){
        return await this.tenantRepository.getTenantById(id)
    }

    async getTenantByName(name:string){
        return await this.tenantRepository.getTenantByName(name)
    }

    async createTenant(data:{
        companyName:string,
        isVatRegistered:boolean,
        vatPercentage?:number
    }){
        if(data.vatPercentage && !data.isVatRegistered){
            throw new Error("VAT percentage cannot be set if the tenant is not VAT registered")
        }

        if(data.vatPercentage){
            data.vatPercentage = parseFloat(data.vatPercentage.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
        }
    
        return await this.tenantRepository.createTenant(data)
    }

    async updateTenant(id:string, data:Partial<Tenant>){
        return await this.tenantRepository.updateTenant(id, data)
    }

    async deleteTenant(id:string){
        return await this.tenantRepository.deleteTenant(id)
    }


    async createDefaultBusinessConfig(tenantId:string, data:{
        currency?:string,
        termsAndConditions?:string,
    }){
        return await this.tenantRepository.createBusinessConfiguration(tenantId, {
            currency:data.currency || "USD",
            termsAndConditions:data.termsAndConditions || "Default terms and conditions"
            })
        
    }

    async getBusinessConfig(tenantId:string){
        return await this.tenantRepository.getBusinessConfiguration(tenantId)
    }

    async updateBusinessConfig(tenantId:string, data:Partial<BusinessConfig>){
        return await this.tenantRepository.updateBusinessConfiguration(tenantId, data)  
    }

    async deleteBusinessConfig(tenantId:string){
        return await this.tenantRepository.deleteBusinessConfiguration(tenantId)
    }
}
