import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

@Injectable()
export class S3Service {
    private readonly logger = new Logger(S3Service.name);

    constructor(private readonly config: ConfigService) {
        // console.log('Initializing Cloudinary configuration');
        // console.log('CLOUDINARY_CLOUD_NAME:', config.get('CLOUDINARY_CLOUD_NAME'));
        // console.log('CLOUDINARY_API_KEY:', config.get('CLOUDINARY_API_KEY'));
        // console.log('CLOUDINARY_API_SECRET:', config.get('CLOUDINARY_API_SECRET'));
        // Configure Cloudinary
        cloudinary.config({
            cloud_name: config.get('CLOUDINARY_CLOUD_NAME'),
            api_key: config.get('CLOUDINARY_API_KEY'),
            api_secret: config.get('CLOUDINARY_API_SECRET'),
        });

        this.logger.log('Cloudinary configured successfully');
    }

    /**
     * Upload a file to Cloudinary
     * @param file - Express.Multer.File object
     * @param folder - Cloudinary folder name (e.g., 'kyc-documents', 'product-images')
     * @returns Cloudinary upload response with secure_url
     */
    async uploadFile(
        file: Express.Multer.File,
        folder: string = 'eventra-service-uploads',
    ): Promise<UploadApiResponse> {
        this.logger.log(`Uploading file to Cloudinary folder: ${folder}`);

        return new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    folder: `eventra-service-uploads`,
                    resource_type: 'auto',
                    public_id: `${Date.now()}-${file.originalname.split('.')[0]}`,
                },
                (error, result) => {
                    if (error) {
                        this.logger.error('Cloudinary upload error:', error);
                        return reject(error);
                    }
                    this.logger.log(`File uploaded successfully: ${result?.secure_url}`);
                    resolve(result!);
                },
            );

            // Write the file buffer to the upload stream
            uploadStream.end(file.buffer);
        });
    }

    /**
     * Upload multiple files to Cloudinary
     */
    async uploadMultipleFiles(
        files: Express.Multer.File[],
        folder: string = 'eventra-service-uploads',
    ): Promise<UploadApiResponse[]> {
        this.logger.log(`Uploading ${files.length} files to Cloudinary`);

        const uploadPromises = files.map(file => this.uploadFile(file, folder));
        return Promise.all(uploadPromises);
    }

    /**
     * Delete a file from Cloudinary by public_id
     */
    async deleteFile(publicId: string): Promise<any> {
        this.logger.log(`Deleting file from Cloudinary: ${publicId}`);

        return new Promise((resolve, reject) => {
            cloudinary.uploader.destroy(publicId, (error, result) => {
                if (error) {
                    this.logger.error('Cloudinary delete error:', error);
                    return reject(error);
                }
                this.logger.log(`File deleted successfully: ${publicId}`);
                resolve(result);
            });
        });
    }
}
